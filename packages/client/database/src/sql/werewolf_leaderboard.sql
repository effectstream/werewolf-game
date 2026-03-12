/* @name upsertLeaderboardEntry */
INSERT INTO werewolf_leaderboard (midnight_address, total_points, games_played, games_won, rounds_survived, last_updated_block)
VALUES (:midnight_address!, :total_points!, :games_played!, :games_won!, :rounds_survived!, :last_updated_block!)
ON CONFLICT (midnight_address) DO UPDATE SET
  total_points    = werewolf_leaderboard.total_points    + EXCLUDED.total_points,
  games_played    = werewolf_leaderboard.games_played    + EXCLUDED.games_played,
  games_won       = werewolf_leaderboard.games_won       + EXCLUDED.games_won,
  rounds_survived = werewolf_leaderboard.rounds_survived + EXCLUDED.rounds_survived,
  last_updated_block = EXCLUDED.last_updated_block;

/* @name getLeaderboard */
SELECT midnight_address, total_points, games_played, games_won, rounds_survived
FROM werewolf_leaderboard
ORDER BY total_points DESC
LIMIT :limit! OFFSET :offset!;

/* @name getPlayerDataForGame */
SELECT public_key_hex, midnight_address, player_idx, role
FROM werewolf_lobby_players
WHERE game_id = :game_id!
  AND midnight_address IS NOT NULL
  AND player_idx IS NOT NULL
  AND role IS NOT NULL;

/* @name getRoundsSurvivedForPlayer */
SELECT COUNT(DISTINCT round)::INT AS rounds_survived
FROM werewolf_alive_snapshot
WHERE game_id = :game_id! AND player_idx = :player_idx!;
