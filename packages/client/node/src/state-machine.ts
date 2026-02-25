import { PaimaSTM } from "@paimaexample/sm";
import { grammar } from "@example-midnight/data-types/grammar";
import type { BaseStfInput } from "@paimaexample/sm";
import { createScheduledData } from "@paimaexample/db";
import {
  type IGetAliveSnapshotsResult,
  type IGetRoundStateResult,
  getAliveSnapshots,
  getRoundState,
  insertPendingPunishment,
  resolveRound,
  setRoundTimeout,
  snapshotAlivePlayer,
  updateRoundVoteCount,
  upsertRoundState,
} from "@example-midnight/database";
import type { StartConfigGameStateTransitions } from "@paimaexample/runtime";
import { type SyncStateUpdateStream, World } from "@paimaexample/coroutine";

const stm = new PaimaSTM<typeof grammar, any>(grammar);

const VOTE_TIMEOUT_BLOCKS = Number(
  Deno.env.get("WEREWOLF_VOTE_TIMEOUT_BLOCKS") ?? "150",
);

// ---------------------------------------------------------------------------
// Helpers for parsing Midnight ledger map / vector formats
// ---------------------------------------------------------------------------

/**
 * Midnight ledger maps come through as either a plain JS object or a Map.
 * Return a plain Record for uniform access.
 */
function parseLedgerMap(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (raw instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of raw.entries()) {
      out[String(k)] = v;
    }
    return out;
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

/**
 * Extract alive player indices from the playerAlive ledger vector.
 * Handles both array-of-{key,value} and plain object keyed by index.
 */
function extractAliveIndices(aliveVec: unknown): number[] {
  if (aliveVec == null) return [];
  const indices: number[] = [];

  if (Array.isArray(aliveVec)) {
    for (const entry of aliveVec) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        const alive = e["value"] ?? e["alive"];
        if (alive === true) {
          const idx = e["key"] ?? e["playerIdx"] ?? e["index"];
          if (typeof idx === "number") indices.push(idx);
        }
      }
    }
    return indices;
  }

  const map = parseLedgerMap(aliveVec);
  for (const [k, v] of Object.entries(map)) {
    if (v === true) {
      const idx = Number(k);
      if (!isNaN(idx)) indices.push(idx);
    }
  }
  return indices;
}

/**
 * Extract the moves-submitted count for a specific (gameId, round).
 *
 * The ledger field is keyed by GameRoundKey which may serialize in various
 * formats; we try several candidates and fall back to JSON.parse iteration.
 */
function extractVoteCount(
  movesMap: unknown,
  gameId: number,
  round: number,
): number {
  if (movesMap == null) return 0;
  const map = parseLedgerMap(movesMap);

  const candidates = [
    JSON.stringify({ gameId, round }),
    JSON.stringify({ game_id: gameId, round }),
    `GameRoundKey { gameId: ${gameId}, round: ${round} }`,
    `${gameId}:${round}`,
    String(gameId * 1000 + round),
  ];

  for (const key of candidates) {
    if (key in map) {
      const val = map[key];
      return typeof val === "number" ? val : Number(val) || 0;
    }
  }

  for (const [k, v] of Object.entries(map)) {
    try {
      const parsed = JSON.parse(k);
      if (
        parsed &&
        (parsed.gameId === gameId || parsed.game_id === gameId) &&
        parsed.round === round
      ) {
        return typeof v === "number" ? v : Number(v) || 0;
      }
    } catch {
      // not JSON
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// STF: midnightContractState
// Fires on every Midnight ledger state update. Detects new rounds, snapshots
// alive players, and schedules a timeout via Paima scheduled data.
// ---------------------------------------------------------------------------

stm.addStateTransition(
  "midnightContractState",
  function* (data) {
    const payload = data.parsedInput.payload;
    const blockHeight = data.blockHeight;

    console.log("[midnight] Contract state update at block", blockHeight);

    const games = parseLedgerMap(payload.Werewolf_games);
    const aliveMap = parseLedgerMap(payload.Werewolf_playerAlive);
    const movesMap = (payload as Record<string, unknown>)["Werewolf_movesSubmittedCount"];

    for (const [gameKey, gameVal] of Object.entries(games)) {
      let gameId: number;
      try {
        const parsed = JSON.parse(gameKey);
        gameId = typeof parsed === "number"
          ? parsed
          : Number(parsed.id ?? parsed.gameId ?? parsed);
      } catch {
        gameId = Number(gameKey);
      }
      if (isNaN(gameId)) continue;

      const game = gameVal as Record<string, unknown>;
      if (!game) continue;

      const round = typeof game["round"] === "number"
        ? game["round"]
        : Number(game["round"] ?? 0);
      const phaseRaw = game["phase"] ?? game["currentPhase"] ?? "day";
      const phase = typeof phaseRaw === "string" ? phaseRaw : String(phaseRaw);

      const aliveForGame = aliveMap[String(gameId)] ?? aliveMap[gameKey] ?? aliveMap;
      const aliveIndices = extractAliveIndices(aliveForGame);
      const aliveCount = aliveIndices.length;

      if (aliveCount === 0) continue;

      const existingRows = (yield* World.resolve(getRoundState, {
        game_id: gameId,
        round,
        phase,
      })) as IGetRoundStateResult[];

      if (existingRows.length > 0) {
        // Round already initialised — sync vote count if it changed
        const currentVotes = extractVoteCount(movesMap, gameId, round);
        const dbVotes = existingRows[0].votes_submitted;

        if (currentVotes !== dbVotes) {
          yield* World.resolve(updateRoundVoteCount, {
            game_id: gameId,
            round,
            phase,
            votes_submitted: currentVotes,
          });
          console.log(
            `[midnight] game=${gameId} round=${round} phase=${phase} votes=${currentVotes}/${aliveCount}`,
          );
        }
        continue;
      }

      // New round — persist state, snapshot alive players, schedule timeout
      console.log(
        `[midnight] New round detected game=${gameId} round=${round} phase=${phase} alive=${aliveCount}`,
      );

      yield* World.resolve(upsertRoundState, {
        game_id: gameId,
        round,
        phase,
        alive_count: aliveCount,
        round_started_block: blockHeight,
      });

      for (const playerIdx of aliveIndices) {
        yield* World.resolve(snapshotAlivePlayer, {
          game_id: gameId,
          round,
          phase,
          player_idx: playerIdx,
        });
      }

      const timeoutBlock = blockHeight + VOTE_TIMEOUT_BLOCKS;

      yield* World.resolve(setRoundTimeout, {
        game_id: gameId,
        round,
        phase,
        timeout_block: timeoutBlock,
      });

      // Schedule the timeout STF to fire at timeoutBlock
      const scheduledInput = JSON.stringify([
        "werewolfRoundTimeout",
        gameId,
        round,
        phase,
      ]);
      yield* createScheduledData(
        scheduledInput,
        { blockHeight: timeoutBlock },
        { precompile: "system_generated" },
      );

      console.log(
        `[midnight] Scheduled timeout game=${gameId} round=${round} phase=${phase} at block=${timeoutBlock}`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// STF: werewolfRoundTimeout
// Fires at the scheduled block. Queues punishments for players who missed
// their vote, then marks the round resolved.
// ---------------------------------------------------------------------------

stm.addStateTransition(
  "werewolfRoundTimeout",
  function* (data) {
    const { gameId, round, phase } = data.parsedInput as {
      gameId: number;
      round: number;
      phase: string;
    };

    const blockHeight = data.blockHeight;

    console.log(
      `[timeout] Fired for game=${gameId} round=${round} phase=${phase} at block=${blockHeight}`,
    );

    const roundRows = (yield* World.resolve(getRoundState, {
      game_id: gameId,
      round,
      phase,
    })) as IGetRoundStateResult[];

    if (roundRows.length === 0) {
      console.warn("[timeout] No round state found — skipping");
      return;
    }

    const roundState = roundRows[0];

    if (roundState.resolved) {
      console.log("[timeout] Round already resolved — skipping");
      return;
    }

    const missing = roundState.alive_count - roundState.votes_submitted;

    if (missing <= 0) {
      console.log("[timeout] All players voted — no punishments needed");
      yield* World.resolve(resolveRound, { game_id: gameId, round, phase });
      return;
    }

    console.log(`[timeout] ${missing} player(s) missed vote — queuing punishments`);

    // Because nightAction/voteDay use Merkle-proof anonymity, we cannot tell
    // exactly who voted. As a deterministic fallback we punish the last
    // `missing` players from the alive snapshot (sorted by player_idx ASC).
    const aliveRows = (yield* World.resolve(getAliveSnapshots, {
      game_id: gameId,
      round,
      phase,
    })) as IGetAliveSnapshotsResult[];

    const toPublish = aliveRows.slice(-missing);
    for (const row of toPublish) {
      yield* World.resolve(insertPendingPunishment, {
        game_id: gameId,
        player_idx: row.player_idx,
        reason: `vote_timeout_${phase}_r${round}`,
        created_at_block: blockHeight,
      });
      console.log(
        `[timeout] Queued punishment game=${gameId} player=${row.player_idx}`,
      );
    }

    yield* World.resolve(resolveRound, { game_id: gameId, round, phase });
  },
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const gameStateTransitions: StartConfigGameStateTransitions = function* (
  blockHeight: number,
  input: BaseStfInput,
): SyncStateUpdateStream<void> {
  if (blockHeight >= 0) {
    yield* stm.processInput(input);
  } else {
    yield* stm.processInput(input);
  }
  return;
};
