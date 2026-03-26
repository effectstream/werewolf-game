/**
 * Leaderboard score calculation and persistence.
 *
 * Called once per game when the game finishes (detected by midnightContractState STF).
 * Only players who provided a Midnight Shielded address when joining the lobby are tracked.
 *
 * Scoring:
 *  - 5 pts: game participation (any completed game)
 *  - 10 pts × rounds survived (distinct round numbers in werewolf_alive_snapshot)
 *  - 50 pts bonus: on the winning team
 */

import type { Pool } from "pg";
import {
  getPlayerDataForGame,
  getRoundsSurvivedForPlayer,
  upsertLeaderboardEntry,
} from "@werewolf-game/database";

/**
 * Migrates leaderboard points from a proxy Midnight address to a real Lace address.
 * Called fire-and-forget from the claim_real_wallet STF handler.
 *
 * The real address entry accumulates additively (same upsert query as scoring),
 * and the proxy entry is zeroed out (kept for audit purposes).
 */
export async function migrateLeaderboardPoints(
  proxyMidnightAddress: string,
  realMidnightAddress: string,
  blockHeight: number,
  dbConn: Pool,
): Promise<void> {
  // Wrap in a transaction: atomically zero the proxy and credit the real address.
  // If the process crashes mid-write the rollback leaves the proxy intact, so the
  // next call (e.g. manual re-trigger) will retry successfully.
  const client = await dbConn.connect();
  try {
    await client.query("BEGIN");

    // Atomic acquire: zero the proxy row in the same statement we read it,
    // so a second concurrent call sees 0 rows and exits early.
    const acquireResult = await client.query<{
      total_points: string;
      games_played: number;
      games_won: number;
      rounds_survived: number;
    }>(
      `UPDATE werewolf_leaderboard
       SET total_points = 0, games_played = 0, games_won = 0, rounds_survived = 0
       WHERE midnight_address = $1 AND (total_points > 0 OR games_played > 0)
       RETURNING total_points, games_played, games_won, rounds_survived`,
      [proxyMidnightAddress],
    );

    if (acquireResult.rows.length === 0) {
      await client.query("COMMIT");
      console.log(
        `[leaderboard] proxy=${proxyMidnightAddress.slice(0, 12)}… has no points or already migrated — skipping`,
      );
      return;
    }

    const proxy = acquireResult.rows[0];
    const totalPoints = Number(proxy.total_points);

    // Upsert into real address (accumulates if real address already has points).
    await upsertLeaderboardEntry.run({
      midnight_address: realMidnightAddress,
      total_points: totalPoints,
      games_played: proxy.games_played,
      games_won: proxy.games_won,
      rounds_survived: proxy.rounds_survived,
      last_updated_block: blockHeight,
    }, client);

    await client.query("COMMIT");

    console.log(
      `[leaderboard] Migrated ${totalPoints} pts from proxy=${proxyMidnightAddress.slice(0, 12)}… ` +
        `to real=${realMidnightAddress.slice(0, 12)}…`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const POINTS_PARTICIPATION = 5;
const POINTS_PER_ROUND = 10;
const POINTS_WIN_BONUS = 50;

export async function calculateAndPersistScores(
  gameId: number,
  winner: "VILLAGERS" | "WEREWOLVES" | "DRAW",
  blockHeight: number,
  dbConn: Pool,
): Promise<void> {
  // Wrap everything in a transaction so the leaderboard_processed flag and all
  // score upserts are committed atomically. If the process crashes mid-write the
  // transaction rolls back, the flag stays FALSE, and the next block replay retries.
  // This replaces the previous yield* markLeaderboardProcessed in the STF, which
  // set the flag before the writes and created a silent data-loss window on crash.
  const client = await dbConn.connect();
  try {
    await client.query("BEGIN");

    // Atomic test-and-set: claim this game for scoring. A concurrent or replayed
    // call that arrives while we hold the transaction will read leaderboard_processed
    // = FALSE (our write isn't visible yet), but after we COMMIT it will see TRUE
    // and skip. The STF fires at most once per game anyway due to the pre-check,
    // so this is a belt-and-suspenders guard.
    const markResult = await client.query(
      `UPDATE werewolf_game_view
       SET leaderboard_processed = TRUE
       WHERE game_id = $1 AND leaderboard_processed = FALSE`,
      [gameId],
    );

    if (markResult.rowCount === 0) {
      await client.query("COMMIT");
      console.log(`[leaderboard] game=${gameId}: already processed — skipping`);
      return;
    }

    console.log(`[leaderboard] Calculating scores for game=${gameId} winner=${winner}`);

    // Get all players who have a Midnight address, player_idx, and role set.
    const players = await getPlayerDataForGame.run({ game_id: gameId }, client);

    if (players.length === 0) {
      await client.query("COMMIT");
      console.log(`[leaderboard] game=${gameId}: no players with Midnight addresses — skipping`);
      return;
    }

    for (const player of players) {
      const playerIdx = player.player_idx!;
      const midnightAddress = player.midnight_address!;

      if (player.role === null) {
        console.warn(
          `[leaderboard] game=${gameId} playerIdx=${playerIdx}: role is null — defaulting to villager`,
        );
      }
      // role 0 = villager, role 1 = werewolf, roles 2/3 (seer/doctor) side with villagers.
      const role = player.role ?? 0;

      // Count distinct rounds the player appears in alive_snapshot.
      const [survivalRow] = await getRoundsSurvivedForPlayer.run(
        { game_id: gameId, player_idx: playerIdx },
        client,
      );
      const roundsSurvived = survivalRow?.rounds_survived ?? 0;

      const isWerewolf = role === 1;
      const onWinningTeam = isWerewolf
        ? winner === "WEREWOLVES"
        : winner === "VILLAGERS";

      const points =
        POINTS_PARTICIPATION +
        roundsSurvived * POINTS_PER_ROUND +
        (onWinningTeam ? POINTS_WIN_BONUS : 0);

      await upsertLeaderboardEntry.run({
        midnight_address: midnightAddress,
        total_points: points,
        games_played: 1,
        games_won: onWinningTeam ? 1 : 0,
        rounds_survived: roundsSurvived,
        last_updated_block: blockHeight,
      }, client);

      console.log(
        `[leaderboard] game=${gameId} midnight=${midnightAddress.slice(0, 10)}…` +
          ` playerIdx=${playerIdx} role=${role} rounds=${roundsSurvived}` +
          ` onWinningTeam=${onWinningTeam} points=${points}`,
      );
    }

    await client.query("COMMIT");
    console.log(`[leaderboard] game=${gameId}: scores persisted for ${players.length} player(s)`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
