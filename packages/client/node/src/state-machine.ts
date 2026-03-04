import { PaimaSTM } from "@paimaexample/sm";
import { grammar } from "@werewolf-game/data-types/grammar";
import type { BaseStfInput } from "@paimaexample/sm";
import { createScheduledData } from "@paimaexample/db";
import {
  closeLobby,
  getAliveSnapshots,
  getLobby,
  getWerewolfRoundState,
  type IGetAliveSnapshotsResult,
  type IGetLobbyResult,
  type IGetRoundStateResult,
  incrementLobbyPlayerCount,
  insertLobbyPlayer,
  insertPendingPunishment,
  resolveRound,
  setLobbyTimeout,
  setRoundTimeout,
  snapshotAlivePlayer,
  updateRoundVoteCount,
  upsertGameView,
  upsertRoundState,
} from "@werewolf-game/database";
import type { IInsertLobbyPlayerResult } from "@werewolf-game/database";
import type { StartConfigGameStateTransitions } from "@paimaexample/runtime";
import { type SyncStateUpdateStream, World } from "@paimaexample/coroutine";
import { WerewolfLedger } from "../../../shared/utils/werewolf-ledger.ts";
import { purgeVotes } from "./store.ts";

const stm = new PaimaSTM<typeof grammar, any>(grammar);

const VOTE_TIMEOUT_BLOCKS = Number(
  Deno.env.get("WEREWOLF_VOTE_TIMEOUT_BLOCKS") ?? "180",
);

const LOBBY_TIMEOUT_BLOCKS = Number(
  Deno.env.get("WEREWOLF_LOBBY_TIMEOUT_BLOCKS") ?? "600",
);

const LOBBY_MIN_PLAYERS = Number(
  Deno.env.get("WEREWOLF_LOBBY_MIN_PLAYERS") ?? "5",
);

const CHAT_SERVER_URL = Deno.env.get("CHAT_SERVER_URL") ??
  "http://localhost:3001";

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

      // Immutable snapshot of this game's state.
      const gameView = ledger.getGameView(gameId);

      // Validate derived values before hitting the DB — NaN or non-finite
      // numbers cause a silent PostgreSQL type error that aborts the tx.
      if (!gameView.isValid()) {
        console.error(
          `[midnight] SKIPPING game=${gameId}: non-finite value detected`,
          {
            round: gameView.round,
            playerCount: gameView.playerCount,
            aliveCount: gameView.aliveCount,
            werewolfCount: gameView.werewolfCount,
            villagerCount: gameView.villagerCount,
            phase: gameView.phase,
            rawKey,
          },
        );
        continue;
      }

      console.log(
        `[midnight] game=${gameId} round=${gameView.round} phase=${gameView.phase}` +
          ` aliveCount=${gameView.aliveCount} aliveIndices=[${
            [...gameView.aliveIndices].join(",")
          }]`,
      );

      // Upsert the denormalised game view used by the frontend.
      // werewolf_indices is only populated when the game is finished (future work).
      yield* World.resolve(upsertGameView, {
        game_id: gameId,
        phase: gameView.phase,
        round: gameView.round,
        player_count: gameView.playerCount,
        alive_count: gameView.aliveCount,
        werewolf_count: gameView.werewolfCount,
        villager_count: gameView.villagerCount,
        alive_vector: JSON.stringify([...gameView.aliveVector]),
        finished: gameView.isFinished,
        werewolf_indices: JSON.stringify([]),
        updated_block: blockHeight,
      });

      // Skip round-state logic for games with no alive players.
      if (gameView.aliveCount === 0) {
        console.log(
          `[midnight] game=${gameId} skipping round-state logic` +
            ` (aliveCount=0, playerCount=${gameView.playerCount})`,
        );
        continue;
      }

      const existingRows = (yield* World.resolve(getWerewolfRoundState, {
        game_id: gameId,
        round: gameView.round,
        phase: gameView.phase,
      })) as IGetRoundStateResult[];

      if (existingRows.length > 0) {
        // Round already initialised — sync vote count if it changed.
        const currentVotes = ledger.voteCount(gameId, gameView.round);
        const dbVotes = Number(existingRows[0].votes_submitted);

        if (currentVotes !== dbVotes) {
          yield* World.resolve(updateRoundVoteCount, {
            game_id: gameId,
            round: gameView.round,
            phase: gameView.phase,
            votes_submitted: currentVotes,
          });
          console.log(
            `[midnight] game=${gameId} round=${gameView.round}` +
              ` phase=${gameView.phase} votes=${currentVotes}/${gameView.aliveCount}`,
          );
        }
        continue;
      }

      // New round — persist state, snapshot alive players, schedule timeout.
      console.log(
        `[midnight] New round detected game=${gameId} round=${gameView.round}` +
          ` phase=${gameView.phase} alive=${gameView.aliveCount}`,
      );

      yield* World.resolve(upsertRoundState, {
        game_id: gameId,
        round: gameView.round,
        phase: gameView.phase,
        alive_count: gameView.aliveCount,
        round_started_block: blockHeight,
      });

      for (const playerIdx of gameView.aliveIndices) {
        yield* World.resolve(snapshotAlivePlayer, {
          game_id: gameId,
          round: gameView.round,
          phase: gameView.phase,
          player_idx: playerIdx,
        });
      }

      const timeoutBlock = blockHeight + VOTE_TIMEOUT_BLOCKS;

      yield* World.resolve(setRoundTimeout, {
        game_id: gameId,
        round: gameView.round,
        phase: gameView.phase,
        timeout_block: timeoutBlock,
      });

      // Schedule the timeout STF to fire at timeoutBlock.
      // Phase is stored as the normalised string so werewolfRoundTimeout
      // receives "NIGHT"/"DAY" and can query the DB without conversion.
      const scheduledInput = JSON.stringify([
        "werewolfRoundTimeout",
        gameId,
        gameView.round,
        gameView.phase,
      ]);
      yield* createScheduledData(
        scheduledInput,
        { blockHeight: timeoutBlock },
        { precompile: "system_generated" },
      );

      console.log(
        `[midnight] Scheduled timeout game=${gameId} round=${gameView.round}` +
          ` phase=${gameView.phase} at block=${timeoutBlock}`,
      );

      // Purge in-memory votes for the phase that just ended now that the new
      // round/phase is confirmed on-chain.
      if (gameView.prevRound >= 1) {
        purgeVotes(gameId, gameView.prevRound, gameView.prevPhase);
      }

      // Detect and announce player deaths by comparing the previous phase's
      // alive snapshot against the current effective alive set.
      // prevPhase is already "NIGHT"/"DAY" — no numeric-code conversion needed.
      console.log(
        `[midnight] Death detection game=${gameId}` +
          ` checking prev round=${gameView.prevRound} phase=${gameView.prevPhase}` +
          ` (current round=${gameView.round} phase=${gameView.phase})`,
      );

      if (gameView.prevRound >= 1) {
        const prevAliveSnapshots = (yield* World.resolve(getAliveSnapshots, {
          game_id: gameId,
          round: gameView.prevRound,
          phase: gameView.prevPhase,
        })) as IGetAliveSnapshotsResult[];

        console.log(
          `[midnight] Death detection game=${gameId} prevAlive=[${
            prevAliveSnapshots.map((r) => r.player_idx).join(",")
          }] currentAlive=[${[...gameView.aliveSet].join(",")}]`,
        );

        const deadPlayers = prevAliveSnapshots.filter(
          (r) => !gameView.aliveSet.has(r.player_idx),
        );

        console.log(
          `[midnight] Death detection game=${gameId} dead=[${
            deadPlayers.map((r) => r.player_idx).join(",")
          }]`,
        );

        for (const dead of deadPlayers) {
          chatPost("/broadcast", {
            gameId,
            text: `Player ${dead.player_idx} was eliminated during the` +
              ` ${gameView.prevPhase} phase of round ${gameView.prevRound}.`,
          });
        }
      } else {
        console.log(
          `[midnight] Death detection game=${gameId}` +
            ` skipped (prevRound=${gameView.prevRound} < 1, first night)`,
        );
      }

      chatPost("/broadcast", {
        gameId,
        text: `Round ${gameView.round} started (${gameView.phase} phase).` +
          ` Alive: ${gameView.aliveCount} players.`,
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

    const roundRows = (yield* World.resolve(getWerewolfRoundState, {
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
      text:
        `Round ${round} (${phase}) ended. ${missing} player(s) missed their vote.`,
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

    // The API handler already created the lobby with upsertLobby (including admin_sign_public_key).
    // This STF only handles scheduling the lobby timeout via Paima scheduled data.

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
    console.log(
      "[join_game] RAW data.parsedInput:",
      JSON.stringify(data.parsedInput),
    );
    console.log(
      "[join_game] RAW data keys:",
      JSON.stringify(Object.keys(data)),
    );

    const { gameId, midnightAddressHash, nickname } = data.parsedInput as {
      gameId: number;
      midnightAddressHash: string;
      nickname: string;
    };
    const blockHeight = data.blockHeight;

    console.log(
      `[lobby] join_game game=${gameId} player=${midnightAddressHash} nickname=${nickname} at block=${blockHeight}`,
    );

    const insertResult = (yield* World.resolve(insertLobbyPlayer, {
      game_id: gameId,
      midnight_address_hash: midnightAddressHash,
      nickname,
      joined_block: blockHeight,
    })) as unknown as IInsertLobbyPlayerResult[];

    // Only increment player count if the insert actually happened (RETURNING game_id exists)
    // This prevents double-increment when the HTTP handler has already inserted the player.
    if (insertResult.length > 0) {
      yield* World.resolve(incrementLobbyPlayerCount, {
        game_id: gameId,
      });
    }

    chatPost("/invite", { gameId, midnightAddressHash, nickname });
    chatPost("/broadcast", {
      gameId,
      text: `${nickname} joined the game.`,
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
      console.warn(
        `[lobby-timeout] No lobby found for game=${gameId} — skipping`,
      );
      return;
    }

    const lobby = lobbyRows[0];

    if (lobby.closed) {
      console.log(
        `[lobby-timeout] Lobby game=${gameId} already closed — skipping`,
      );
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
