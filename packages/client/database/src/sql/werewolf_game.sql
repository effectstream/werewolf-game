/* @name upsertRoundState */
INSERT INTO werewolf_round_state (game_id, round, phase, alive_count, round_started_block)
VALUES (:game_id!, :round!, :phase!, :alive_count!, :round_started_block!)
ON CONFLICT (game_id, round, phase) DO NOTHING;

/* @name getRoundState */
SELECT * FROM werewolf_round_state
WHERE game_id = :game_id! AND round = :round! AND phase = :phase!;

/* @name updateRoundVoteCount */
UPDATE werewolf_round_state
SET votes_submitted = :votes_submitted!
WHERE game_id = :game_id! AND round = :round! AND phase = :phase!;

/* @name setRoundTimeout */
UPDATE werewolf_round_state
SET timeout_block = :timeout_block!
WHERE game_id = :game_id! AND round = :round! AND phase = :phase!;

/* @name resolveRound */
UPDATE werewolf_round_state
SET resolved = TRUE
WHERE game_id = :game_id! AND round = :round! AND phase = :phase!;

/* @name snapshotAlivePlayer */
INSERT INTO werewolf_alive_snapshot (game_id, round, phase, player_idx)
VALUES (:game_id!, :round!, :phase!, :player_idx!)
ON CONFLICT (game_id, round, phase, player_idx) DO NOTHING;

/* @name getAliveSnapshots */
SELECT player_idx FROM werewolf_alive_snapshot
WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
ORDER BY player_idx ASC;

/* @name insertPendingPunishment */
INSERT INTO werewolf_pending_punishments (game_id, player_idx, reason, created_at_block)
VALUES (:game_id!, :player_idx!, :reason!, :created_at_block!);

/* @name getPendingPunishments */
SELECT id, game_id, player_idx, reason, created_at_block
FROM werewolf_pending_punishments
WHERE executed = FALSE
ORDER BY created_at_block ASC;

/* @name markPunishmentExecuted */
UPDATE werewolf_pending_punishments
SET executed = TRUE
WHERE id = :id!;
