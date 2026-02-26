/* @name upsertLobby */
INSERT INTO werewolf_lobby (game_id, max_players, created_block)
VALUES (:game_id!, :max_players!, :created_block!)
ON CONFLICT (game_id) DO NOTHING;

/* @name getLobby */
SELECT * FROM werewolf_lobby WHERE game_id = :game_id!;

/* @name setLobbyTimeout */
UPDATE werewolf_lobby
SET timeout_block = :timeout_block!
WHERE game_id = :game_id!;

/* @name incrementLobbyPlayerCount */
UPDATE werewolf_lobby
SET player_count = player_count + 1
WHERE game_id = :game_id!;

/* @name closeLobby */
UPDATE werewolf_lobby
SET closed = TRUE
WHERE game_id = :game_id!;

/* @name insertLobbyPlayer */
INSERT INTO werewolf_lobby_players (game_id, midnight_address_hash, joined_block)
VALUES (:game_id!, :midnight_address_hash!, :joined_block!)
ON CONFLICT (game_id, midnight_address_hash) DO NOTHING;

/* @name getLobbyPlayers */
SELECT midnight_address_hash FROM werewolf_lobby_players
WHERE game_id = :game_id!
ORDER BY joined_block ASC;
