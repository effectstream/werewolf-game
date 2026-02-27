import { PaimaSTM } from "@paimaexample/sm";
import { grammar } from "@werewolf-game/data-types/grammar";
import type { BaseStfInput } from "@paimaexample/sm";
import { createScheduledData } from "@paimaexample/db";
import {
  closeLobby,
  getAliveSnapshots,
  getLobby,
  getRoundState,
  incrementLobbyPlayerCount,
  insertLobbyPlayer,
  insertPendingPunishment,
  type IGetAliveSnapshotsResult,
  type IGetLobbyResult,
  type IGetRoundStateResult,
  resolveRound,
  setLobbyTimeout,
  setRoundTimeout,
  snapshotAlivePlayer,
  updateRoundVoteCount,
  upsertLobby,
  upsertGameView,
  upsertRoundState,
} from "@werewolf-game/database";
import type { StartConfigGameStateTransitions } from "@paimaexample/runtime";
import { type SyncStateUpdateStream, World } from "@paimaexample/coroutine";
import { WerewolfLedger } from "../../../shared/utils/werewolf-ledger.ts";

const stm = new PaimaSTM<typeof grammar, any>(grammar);

const VOTE_TIMEOUT_BLOCKS = Number(
  Deno.env.get("WEREWOLF_VOTE_TIMEOUT_BLOCKS") ?? "150",
);

const LOBBY_TIMEOUT_BLOCKS = Number(
  Deno.env.get("WEREWOLF_LOBBY_TIMEOUT_BLOCKS") ?? "150",
);

const LOBBY_MIN_PLAYERS = Number(
  Deno.env.get("WEREWOLF_LOBBY_MIN_PLAYERS") ?? "5",
);

const CHAT_SERVER_URL = Deno.env.get("CHAT_SERVER_URL") ?? "http://localhost:3001";

// Fire-and-forget POST to the chat server. All calls are best-effort;
// generator functions cannot await, and the game must proceed even if chat is down.
function chatPost(path: string, body: unknown): void {
  void fetch(`${CHAT_SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => console.warn(`[chat] POST ${path} failed:`, err));
}

// ---------------------------------------------------------------------------
// STF: midnightContractState
// Fires on every Midnight ledger state update. Detects new rounds, snapshots
// alive players, and schedules a timeout via Paima scheduled data.
// ---------------------------------------------------------------------------

stm.addStateTransition(
  "midnightContractState",
  function* (data) {
    const ledger = WerewolfLedger.from(data.parsedInput.payload);
    const blockHeight = data.blockHeight;

    console.log("[midnight] Contract state update at block", blockHeight);

    for (const [rawKey] of Object.entries(ledger.games())) {
      const gameId = ledger.parseGameId(rawKey);
      if (isNaN(gameId)) continue;

      const game = ledger.getGame(gameId);
      if (!game) continue;

      const round = ledger.getRound(gameId);
      const phase = ledger.getPhase(gameId);
      const aliveIndices = ledger.aliveIndices(gameId);
      const aliveCount = aliveIndices.length;

      const phaseRaw = game.phase ?? game.currentPhase;
      const finished =
        phaseRaw === "Finished" ||
        phaseRaw === "finished" ||
        phaseRaw === 3 ||
        String(phaseRaw).toLowerCase() === "finished";

      const werewolfCount = Number(game.werewolfCount ?? 0);
      const villagerCount = Number(game.villagerCount ?? 0);

      // Build alive vector and upsert the denormalized game view.
      // When aliveCount is 0 but the game is not finished and playerCount > 0,
      // the ledger snapshot is ambiguous (alive flags not yet propagated).
      // Default every slot to alive so the frontend never shows all players dead
      // before the game has actually started.
      const playerCount = Number(game.playerCount ?? 0);
      const aliveSet = new Set(aliveIndices);
      const aliveVector: boolean[] = [];
      const useAllAlive = !finished && aliveCount === 0 && playerCount > 0;
      for (let i = 0; i < playerCount; i++) {
        aliveVector.push(useAllAlive ? true : aliveSet.has(i));
      }

      // Werewolf indices only populated when game is finished
      const werewolfIndices: number[] = [];

      // Validate derived values before hitting the DB — NaN or non-finite numbers
      // cause a silent PostgreSQL type error that aborts the transaction, making
      // every subsequent query fail with 25P02 instead of the real error.
      if (!Number.isFinite(round) || !Number.isFinite(playerCount) ||
          !Number.isFinite(aliveCount) || !Number.isFinite(werewolfCount) ||
          !Number.isFinite(villagerCount)) {
        console.error(
          `[midnight] SKIPPING game=${gameId}: non-finite value detected`,
          { round, playerCount, aliveCount, werewolfCount, villagerCount, phase, rawKey },
        );
        continue;
      }

      yield* World.resolve(upsertGameView, {
        game_id: gameId,
        phase: String(phase),
        round,
        player_count: playerCount,
        alive_count: aliveCount,
        werewolf_count: werewolfCount,
        villager_count: villagerCount,
        alive_vector: JSON.stringify(aliveVector),
        finished,
        werewolf_indices: JSON.stringify(werewolfIndices),
        updated_block: blockHeight,
      });

      // Skip round-state logic for games with no alive players
      if (aliveCount === 0) continue;

      const existingRows = (yield* World.resolve(getRoundState, {
        game_id: gameId,
        round,
        phase,
      })) as IGetRoundStateResult[];

      if (existingRows.length > 0) {
        // Round already initialised — sync vote count if it changed
        const currentVotes = ledger.voteCount(gameId, round);
        const dbVotes = Number(existingRows[0].votes_submitted);

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

      chatPost("/broadcast", {
        gameId,
        text: `Round ${round} started (${phase} phase). Alive: ${aliveCount} players.`,
      });
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

    const aliveCount = Number(roundState.alive_count);
    const votesSubmitted = Number(roundState.votes_submitted);
    const missing = aliveCount - votesSubmitted;

    if (missing <= 0) {
      console.log("[timeout] All players voted — no punishments needed");
      yield* World.resolve(resolveRound, { game_id: gameId, round, phase });
      chatPost("/broadcast", {
        gameId,
        text: `Round ${round} (${phase}) ended. All players voted.`,
      });
      return;
    }

    console.log(
      `[timeout] ${missing} player(s) missed vote — queuing punishments`,
    );

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
    chatPost("/broadcast", {
      gameId,
      text: `Round ${round} (${phase}) ended. ${missing} player(s) missed their vote.`,
    });
  },
);

// ---------------------------------------------------------------------------
// STF: create_game
// Fires when a create_game input is processed. Records the lobby in the DB
// and schedules a werewolfLobbyTimeout at blockHeight + LOBBY_TIMEOUT_BLOCKS.
// ---------------------------------------------------------------------------

stm.addStateTransition(
  "create_game",
  function* (data) {
    const { gameId, maxPlayers } = data.parsedInput as {
      gameId: number;
      maxPlayers: number;
    };
    const blockHeight = data.blockHeight;

    console.log(
      `[lobby] create_game game=${gameId} maxPlayers=${maxPlayers} at block=${blockHeight}`,
    );

    yield* World.resolve(upsertLobby, {
      game_id: gameId,
      max_players: maxPlayers,
      created_block: blockHeight,
    });

    const timeoutBlock = blockHeight + LOBBY_TIMEOUT_BLOCKS;

    yield* World.resolve(setLobbyTimeout, {
      game_id: gameId,
      timeout_block: timeoutBlock,
    });

    yield* createScheduledData(
      JSON.stringify(["werewolfLobbyTimeout", gameId]),
      { blockHeight: timeoutBlock },
      { precompile: "system_generated" },
    );

    console.log(
      `[lobby] Scheduled lobby timeout game=${gameId} at block=${timeoutBlock}`,
    );
  },
);

// ---------------------------------------------------------------------------
// STF: join_game
// Fires when a join_game input is processed. Adds the player to the lobby
// player list and increments the lobby player count.
// ---------------------------------------------------------------------------

stm.addStateTransition(
  "join_game",
  function* (data) {
    console.log("[join_game] RAW data.parsedInput:", JSON.stringify(data.parsedInput));
    console.log("[join_game] RAW data keys:", JSON.stringify(Object.keys(data)));

    const { gameId, midnightAddressHash } = data.parsedInput as {
      gameId: number;
      midnightAddressHash: string;
    };
    const blockHeight = data.blockHeight;

    console.log(
      `[lobby] join_game game=${gameId} player=${midnightAddressHash} at block=${blockHeight}`,
    );

    yield* World.resolve(insertLobbyPlayer, {
      game_id: gameId,
      midnight_address_hash: midnightAddressHash,
      joined_block: blockHeight,
    });

    yield* World.resolve(incrementLobbyPlayerCount, {
      game_id: gameId,
    });

    chatPost("/invite", { gameId, midnightAddressHash });
    chatPost("/broadcast", {
      gameId,
      text: `Player ${midnightAddressHash.slice(0, 10)}... joined the game.`,
    });
  },
);

// ---------------------------------------------------------------------------
// STF: close_game
// Fires when a close_game input is processed. Marks the lobby as closed.
// ---------------------------------------------------------------------------

stm.addStateTransition(
  "close_game",
  function* (data) {
    const { gameId } = data.parsedInput as { gameId: number };
    const blockHeight = data.blockHeight;

    console.log(
      `[lobby] close_game game=${gameId} at block=${blockHeight}`,
    );

    yield* World.resolve(closeLobby, { game_id: gameId });
    chatPost("/broadcast", { gameId, text: "The lobby has been closed." });
  },
);

// ---------------------------------------------------------------------------
// STF: werewolfLobbyTimeout
// Fires at the scheduled block. If fewer than LOBBY_MIN_PLAYERS have joined,
// force-closes the lobby. Otherwise, the game proceeds normally.
// ---------------------------------------------------------------------------

stm.addStateTransition(
  "werewolfLobbyTimeout",
  function* (data) {
    const { gameId } = data.parsedInput as { gameId: number };
    const blockHeight = data.blockHeight;

    console.log(
      `[lobby-timeout] Fired for game=${gameId} at block=${blockHeight}`,
    );

    const lobbyRows = (yield* World.resolve(getLobby, {
      game_id: gameId,
    })) as IGetLobbyResult[];

    if (lobbyRows.length === 0) {
      console.warn(`[lobby-timeout] No lobby found for game=${gameId} — skipping`);
      return;
    }

    const lobby = lobbyRows[0];

    if (lobby.closed) {
      console.log(`[lobby-timeout] Lobby game=${gameId} already closed — skipping`);
      return;
    }

    if (Number(lobby.player_count) < LOBBY_MIN_PLAYERS) {
      console.log(
        `[lobby-timeout] game=${gameId} has ${lobby.player_count}/${LOBBY_MIN_PLAYERS} players — force-closing lobby`,
      );
      yield* World.resolve(closeLobby, { game_id: gameId });
      console.log(
        `[lobby-timeout] ADMIN ACTION REQUIRED: close EVM game ${gameId} on-chain (insufficient players)`,
      );
      chatPost("/broadcast", {
        gameId,
        text: "Lobby timed out — not enough players. Game cancelled.",
      });
    } else {
      console.log(
        `[lobby-timeout] game=${gameId} has ${lobby.player_count} players — lobby timeout reached, game may proceed`,
      );
      chatPost("/broadcast", {
        gameId,
        text: "Lobby timeout reached — the game will now begin.",
      });
    }
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
