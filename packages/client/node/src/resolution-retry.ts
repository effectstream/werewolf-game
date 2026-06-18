/**
 * Background safety-net timer that retries phase resolution for rounds that
 * are stuck unresolved on-chain.
 *
 * The primary resolution triggers are:
 *   1. midnightContractState STF — fires when the Midnight indexer reports a
 *      new contract state (e.g. a new vote landed).
 *   2. werewolfRoundTimeout STF — fires once at the scheduled timeout block.
 *
 * If both of those fail and no further contract state changes arrive (e.g.
 * only one game is active and all votes are already in), the STF paths never
 * re-trigger. This timer catches that edge case by scanning the DB every
 * 60 seconds for stuck rounds and re-dispatching resolution. `getStuckRounds`
 * returns two kinds of stuck round:
 *   - threshold rounds: votes_submitted >= alive_count (re-run resolution only)
 *   - timeout rounds:    timed_out = TRUE (re-run punishments + resolution; the
 *     vote heuristic can't catch these because votes_submitted < alive_count)
 *
 * The in-memory `_resolutionTriggered` guard prevents concurrent calls with
 * the STF paths — it is set before the async call and cleared on failure. On
 * success the durable `resolved=TRUE` flag (set by resolvePhaseFromLedger) is
 * what stops re-triggering, so the guard is intentionally left set.
 */

import * as store from "./store.ts";
import { resolvePhaseFromLedger } from "./vote-resolver.ts";
import { fetchCurrentLedgerVotes } from "./midnight-circuit-caller.ts";
import { executeTimeoutResolution } from "./state-machine.ts";
import { runPreparedQuery } from "@effectstream/db";
import { getStuckRounds } from "@werewolf-game/database";
import { getDbPool } from "./db-pool.ts";

const RETRY_INTERVAL_MS = 60_000;

let running = false;
let started = false;

export function startResolutionRetryLoop(): void {
  if (started) return;
  started = true;

  console.log("[retry-loop] Starting stuck-round resolution retry loop");
  // Reschedule after each run completes rather than on a fixed interval, so a
  // slow scan (each round can take up to the batcher timeout) never overlaps
  // the next tick.
  const tick = () => {
    void retryStuckRounds()
      .catch((err) => console.error("[retry-loop] Error:", err))
      .finally(() => setTimeout(tick, RETRY_INTERVAL_MS));
  };
  setTimeout(tick, RETRY_INTERVAL_MS);
}

async function retryStuckRounds(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const dbConn = getDbPool();
    const stuckRounds = await runPreparedQuery(
      getStuckRounds.run(undefined, dbConn),
      "getStuckRounds",
    );

    for (const row of stuckRounds) {
      const gameId = Number(row.game_id);
      const round = Number(row.round);
      const phase = String(row.phase);
      const timedOut = Boolean(row.timed_out);

      // Skip if a resolution attempt is already in-flight (set by this loop
      // or by one of the STF paths).
      if (store.isResolutionTriggered(gameId, round, phase)) {
        continue;
      }

      console.warn(
        `[retry-loop] Detected stuck round game=${gameId} round=${round}` +
          ` phase=${phase} timedOut=${timedOut} — retrying resolution`,
      );

      store.setResolutionTriggered(gameId, round, phase);

      try {
        if (timedOut) {
          // Timeout-path round: must re-run punishments before resolution so
          // the on-chain aliveCount reflects ejected non-voters.
          await executeTimeoutResolution(
            gameId,
            round,
            phase,
            Number(row.round_started_block),
          );
        } else {
          const voteEntries = await fetchCurrentLedgerVotes(
            gameId,
            round,
            phase,
          );
          await resolvePhaseFromLedger(gameId, round, phase, voteEntries);
        }
        console.log(
          `[retry-loop] Resolution succeeded game=${gameId} round=${round} phase=${phase}`,
        );
      } catch (err) {
        // Release the guard so the next tick (or STF path) can retry.
        store.clearResolutionTriggered(gameId, round, phase);
        console.error(
          `[retry-loop] Resolution failed game=${gameId} round=${round}` +
            ` phase=${phase} — will retry in ${RETRY_INTERVAL_MS}ms:`,
          err,
        );
      }
    }
  } finally {
    running = false;
  }
}
