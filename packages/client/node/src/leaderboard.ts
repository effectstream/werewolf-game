/**
 * Leaderboard score calculation and persistence.
 *
 * Called once per game when the game finishes (detected by midnightContractState STF).
 * Only players who provided an EVM address when joining the lobby are tracked.
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

const POINTS_PARTICIPATION = 5;
const POINTS_PER_ROUND = 10;
const POINTS_WIN_BONUS = 50;

export async function calculateAndPersistScores(
  gameId: number,
  winner: "VILLAGERS" | "WEREWOLVES",
  blockHeight: number,
  dbConn: Pool,
): Promise<void> {
  console.log(
    `[leaderboard] Calculating scores for game=${gameId} winner=${winner}`,
  );

  // Get all players who have an EVM address, player_idx, and role set.
  const players = await runPreparedQuery(
    getPlayerDataForGame.run({ game_id: gameId }, dbConn),
    "getPlayerDataForGame",
  );

  if (players.length === 0) {
    console.log(
      `[leaderboard] game=${gameId}: no players with EVM addresses — skipping`,
    );
    return;
  }

  for (const player of players) {
    const playerIdx = player.player_idx!;
    const evmAddress = player.evm_address!;
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
        evm_address: evmAddress,
        total_points: points,
        games_played: 1,
        games_won: onWinningTeam ? 1 : 0,
        rounds_survived: roundsSurvived,
        last_updated_block: blockHeight,
      }, dbConn),
      "upsertLeaderboardEntry",
    );

    console.log(
      `[leaderboard] game=${gameId} evm=${evmAddress.slice(0, 10)}…` +
        ` playerIdx=${playerIdx} role=${role} rounds=${roundsSurvived}` +
        ` onWinningTeam=${onWinningTeam} points=${points}`,
    );
  }

  console.log(
    `[leaderboard] game=${gameId}: scores persisted for ${players.length} player(s)`,
  );
}
