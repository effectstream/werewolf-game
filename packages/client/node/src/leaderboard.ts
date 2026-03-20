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
import { runPreparedQuery } from "@paimaexample/db";
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
  const proxyRows = await dbConn.query<{
    total_points: string;
    games_played: number;
    games_won: number;
    rounds_survived: number;
  }>(
    "SELECT total_points, games_played, games_won, rounds_survived FROM werewolf_leaderboard WHERE midnight_address = $1",
    [proxyMidnightAddress],
  );

  if (proxyRows.rows.length === 0) {
    console.log(
      `[leaderboard] No entry for proxy=${proxyMidnightAddress.slice(0, 12)}… — nothing to migrate`,
    );
    return;
  }

  const proxy = proxyRows.rows[0];
  const totalPoints = Number(proxy.total_points);

  if (totalPoints === 0 && proxy.games_played === 0) {
    console.log(
      `[leaderboard] proxy=${proxyMidnightAddress.slice(0, 12)}… has no points — skipping migration`,
    );
    return;
  }

  // Upsert into real address (accumulates if real address already has points)
  await runPreparedQuery(
    upsertLeaderboardEntry.run({
      midnight_address: realMidnightAddress,
      total_points: totalPoints,
      games_played: proxy.games_played,
      games_won: proxy.games_won,
      rounds_survived: proxy.rounds_survived,
      last_updated_block: blockHeight,
    }, dbConn),
    "upsertLeaderboardEntry",
  );

  // Zero out proxy entry (keep row for audit)
  await dbConn.query(
    `UPDATE werewolf_leaderboard
     SET total_points = 0, games_played = 0, games_won = 0, rounds_survived = 0
     WHERE midnight_address = $1`,
    [proxyMidnightAddress],
  );

  console.log(
    `[leaderboard] Migrated ${totalPoints} pts from proxy=${proxyMidnightAddress.slice(0, 12)}… ` +
      `to real=${realMidnightAddress.slice(0, 12)}…`,
  );
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
  console.log(
    `[leaderboard] Calculating scores for game=${gameId} winner=${winner}`,
  );

  // Get all players who have a Midnight address, player_idx, and role set.
  const players = await runPreparedQuery(
    getPlayerDataForGame.run({ game_id: gameId }, dbConn),
    "getPlayerDataForGame",
  );

  if (players.length === 0) {
    console.log(
      `[leaderboard] game=${gameId}: no players with Midnight addresses — skipping`,
    );
    return;
  }

  for (const player of players) {
    const playerIdx = player.player_idx!;
    const midnightAddress = player.midnight_address!;
    const role = player.role ?? 0;

    // Count distinct rounds the player appears in alive_snapshot.
    const [survivalRow] = await runPreparedQuery(
      getRoundsSurvivedForPlayer.run(
        { game_id: gameId, player_idx: playerIdx },
        dbConn,
      ),
      "getRoundsSurvivedForPlayer",
    );
    const roundsSurvived = survivalRow?.rounds_survived ?? 0;

    // Determine if this player was on the winning team.
    // role 0 = villager, role 1 = werewolf, roles 2/3 (seer/doctor) side with villagers.
    const isWerewolf = role === 1;
    const onWinningTeam = isWerewolf
      ? winner === "WEREWOLVES"
      : winner === "VILLAGERS";

    const points =
      POINTS_PARTICIPATION +
      roundsSurvived * POINTS_PER_ROUND +
      (onWinningTeam ? POINTS_WIN_BONUS : 0);

    await runPreparedQuery(
      upsertLeaderboardEntry.run({
        midnight_address: midnightAddress,
        total_points: points,
        games_played: 1,
        games_won: onWinningTeam ? 1 : 0,
        rounds_survived: roundsSurvived,
        last_updated_block: blockHeight,
      }, dbConn),
      "upsertLeaderboardEntry",
    );

    console.log(
      `[leaderboard] game=${gameId} midnight=${midnightAddress.slice(0, 10)}…` +
        ` playerIdx=${playerIdx} role=${role} rounds=${roundsSurvived}` +
        ` onWinningTeam=${onWinningTeam} points=${points}`,
    );
  }

  console.log(
    `[leaderboard] game=${gameId}: scores persisted for ${players.length} player(s)`,
  );
}
