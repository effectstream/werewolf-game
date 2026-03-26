/**
 * Executes pending adminPunishPlayer circuit calls for players who missed
 * their vote during a round timeout, and checks for game-over conditions
 * (including DRAW when all players are eliminated).
 */

import * as store from "./store.ts";
import { callMidnightCircuit } from "./midnight-circuit-caller.ts";
import type { PrivateState } from "../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";
import { runPreparedQuery } from "@paimaexample/db";
import {
  getGameView,
  getPendingPunishments,
  markPunishmentExecuted,
} from "@werewolf-game/database";
import { getDbPool } from "./db-pool.ts";

const BATCHER_URL = Deno.env.get("BATCHER_URL") ?? "http://localhost:3334";

export interface PunishmentResult {
  count: number;
  punishedIndices: number[];
}

/**
 * Execute all pending (unexecuted) punishments for a given game by calling
 * the adminPunishPlayer circuit sequentially. Each call waits for on-chain
 * confirmation before proceeding to the next.
 *
 * @returns The count and indices of successfully executed punishments.
 */
export async function executePendingPunishments(
  gameId: number,
): Promise<PunishmentResult> {
  const secrets = store.getGameSecrets(gameId);
  const adminWalletSeed = secrets?.adminWalletSeed;

  if (!adminWalletSeed) {
    console.error(
      `[punishment] No admin wallet seed for game=${gameId} — cannot execute punishments`,
    );
    return { count: 0, punishedIndices: [] };
  }

  const dbConn = getDbPool();

  const gameViewRows = await runPreparedQuery(
    getGameView.run({ game_id: gameId }, dbConn),
    "getGameView",
  );
  if (gameViewRows.length > 0 && gameViewRows[0].finished) {
    console.log(
      `[punishment] Game=${gameId} already finished — skipping punishment execution`,
    );
    return { count: 0, punishedIndices: [] };
  }

  const allPending = await runPreparedQuery(
    getPendingPunishments.run(undefined, dbConn),
    "getPendingPunishments",
  );

  // Filter to this game only
  const pending = allPending.filter(
    (row) => Number(row.game_id) === gameId,
  );

  if (pending.length === 0) {
    console.log(`[punishment] No pending punishments for game=${gameId}`);
    return { count: 0, punishedIndices: [] };
  }

  console.log(
    `[punishment] Executing ${pending.length} punishment(s) for game=${gameId}`,
  );

  const emptyPrivateState: PrivateState = { setupData: new Map() };
  let executed = 0;
  const punishedIndices: number[] = [];

  for (const row of pending) {
    try {
      await callMidnightCircuit({
        circuitId: "adminPunishPlayer",
        privateState: emptyPrivateState,
        batcherUrl: BATCHER_URL,
        seed: adminWalletSeed,
        callFn: async (contract) => {
          await contract.callTx.adminPunishPlayer(
            BigInt(gameId),
            BigInt(row.player_idx),
          );
        },
      });

      await runPreparedQuery(
        markPunishmentExecuted.run({ id: row.id }, dbConn),
        "markPunishmentExecuted",
      );

      executed++;
      punishedIndices.push(Number(row.player_idx));
      console.log(
        `[punishment] Punished player=${row.player_idx} game=${gameId} (${row.reason})`,
      );
    } catch (err) {
      console.error(
        `[punishment] Failed to punish player=${row.player_idx} game=${gameId}:`,
        err,
      );
      // Continue to next — adminPunishPlayer is idempotent, can retry later
    }
  }

  console.log(
    `[punishment] Executed ${executed}/${pending.length} punishments for game=${gameId}`,
  );
  return { count: executed, punishedIndices };
}

/**
 * After punishments have been executed, check whether the game is over.
 * Uses in-memory bundles to determine team membership (roles are not
 * revealed on-chain until after game end).
 *
 * Handles three outcomes:
 * - DRAW: all players eliminated (aliveWolves === 0 && aliveVillagers === 0)
 * - VILLAGERS win: all werewolves dead
 * - WEREWOLVES win: werewolves >= villagers
 *
 * If game over, calls forceEndGame to set phase=FINISHED on-chain.
 *
 * @returns true if the game ended, false if still in progress.
 */
export async function checkGameOverAfterPunishment(
  gameId: number,
  punishedIndices: number[],
): Promise<boolean> {
  const bundles = store.getAllBundlesForGame(gameId);
  if (bundles.length === 0) {
    console.warn(
      `[punishment] No bundles for game=${gameId} — cannot check game-over`,
    );
    return false;
  }

  const dbConn = getDbPool();
  const rows = await runPreparedQuery(
    getGameView.run({ game_id: gameId }, dbConn),
    "getGameView",
  );
  if (rows.length === 0) {
    console.warn(
      `[punishment] No game view for game=${gameId} — cannot check game-over`,
    );
    return false;
  }

  const aliveVector: boolean[] = JSON.parse(rows[0].alive_vector);
  const aliveSet = new Set<number>();
  for (let i = 0; i < aliveVector.length; i++) {
    if (aliveVector[i]) aliveSet.add(i);
  }
  // Remove recently punished players whose elimination hasn't synced to DB yet
  // (the Paima engine hasn't processed the Midnight block with the punishment txs)
  for (const idx of punishedIndices) {
    aliveSet.delete(idx);
  }

  const aliveWolves = bundles.filter(
    (b) => b.role === 1 && aliveSet.has(b.playerId),
  ).length;
  const aliveVillagers = bundles.filter(
    (b) => b.role !== 1 && aliveSet.has(b.playerId),
  ).length;

  // DRAW: all players eliminated (e.g., everyone timed out)
  const isDraw = aliveWolves === 0 && aliveVillagers === 0;
  const gameOver = isDraw || aliveWolves === 0 || aliveWolves >= aliveVillagers;

  if (!gameOver) return false;

  const winner = isDraw ? "DRAW" : aliveWolves === 0 ? "VILLAGERS" : "WEREWOLVES";
  console.log(
    `[punishment] Game over after punishments: wolves=${aliveWolves} villagers=${aliveVillagers}` +
      ` winner=${winner} — submitting forceEndGame for game=${gameId}`,
  );

  const secrets = store.getGameSecrets(gameId);
  const adminWalletSeed = secrets?.adminWalletSeed;
  if (!adminWalletSeed || !secrets?.masterSecret) {
    console.error(
      `[punishment] Missing secrets for forceEndGame game=${gameId}`,
    );
    return false;
  }

  const emptyPrivateState: PrivateState = { setupData: new Map() };

  try {
    await callMidnightCircuit({
      circuitId: "forceEndGame",
      privateState: emptyPrivateState,
      batcherUrl: BATCHER_URL,
      seed: adminWalletSeed,
      callFn: async (contract) => {
        await contract.callTx.forceEndGame(
          BigInt(gameId),
          secrets.masterSecret,
        );
      },
    });
    console.log(
      `[punishment] forceEndGame submitted game=${gameId} winner=${winner}`,
    );
    return true;
  } catch (err) {
    console.error(
      `[punishment] forceEndGame failed for game=${gameId}:`,
      err,
    );
    return false;
  }
}
