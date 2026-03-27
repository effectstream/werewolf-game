/* @name upsertGameView */
INSERT INTO werewolf_game_view (
  game_id, phase, round, player_count, alive_count,
  werewolf_count, villager_count, alive_vector,
  finished, finished_at, werewolf_indices, updated_block
)
VALUES (
  :game_id!, :phase!, :round!, :player_count!, :alive_count!,
  :werewolf_count!, :villager_count!, :alive_vector!,
  :finished!, :finished_at, :werewolf_indices!, :updated_block!
)
ON CONFLICT (game_id) DO UPDATE SET
  phase            = EXCLUDED.phase,
  round            = EXCLUDED.round,
  player_count     = EXCLUDED.player_count,
  alive_count      = EXCLUDED.alive_count,
  werewolf_count   = EXCLUDED.werewolf_count,
  villager_count   = EXCLUDED.villager_count,
  alive_vector     = EXCLUDED.alive_vector,
  finished         = EXCLUDED.finished,
  finished_at      = COALESCE(werewolf_game_view.finished_at, EXCLUDED.finished_at),
  werewolf_indices = EXCLUDED.werewolf_indices,
  updated_block    = EXCLUDED.updated_block;

/* @name getGameView */
SELECT * FROM werewolf_game_view
WHERE game_id = :game_id!;

/* @name markLeaderboardProcessed */
UPDATE werewolf_game_view
SET leaderboard_processed = TRUE
WHERE game_id = :game_id!;
