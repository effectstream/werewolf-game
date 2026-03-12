/* @name upsertLobby */
INSERT INTO werewolf_lobby (game_id, max_players, created_block, admin_sign_public_key, encrypted_game_seed)
VALUES (:game_id!, :max_players!, :created_block!, :admin_sign_public_key, :encrypted_game_seed)
ON CONFLICT (game_id) DO NOTHING;

/* @name getEncryptedGameSeed */
SELECT encrypted_game_seed FROM werewolf_lobby WHERE game_id = :game_id!;

/* @name getAdminSignKey */
SELECT admin_sign_public_key FROM werewolf_lobby WHERE game_id = :game_id!;

/* @name setAdminSignKeyUpdate */
UPDATE werewolf_lobby
SET admin_sign_public_key = :admin_sign_public_key!
WHERE game_id = :game_id!;

/* @name markBundlesReady */
UPDATE werewolf_lobby
SET bundles_ready = TRUE
WHERE game_id = :game_id!;

/* @name getAndIncrementGameId */
UPDATE werewolf_lobby_sequence
SET last_game_id = last_game_id + 1
WHERE id = 1
RETURNING last_game_id;

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
INSERT INTO werewolf_lobby_players (game_id, public_key_hex, nickname, joined_block)
VALUES (:game_id!, :public_key_hex!, :nickname!, :joined_block!)
ON CONFLICT (game_id, public_key_hex) DO NOTHING
RETURNING game_id;

/* @name getLobbyPlayers */
SELECT public_key_hex, nickname
FROM werewolf_lobby_players
WHERE game_id = :game_id!
ORDER BY joined_block ASC;

/* @name updateLobbyPlayerTrackingFields */
UPDATE werewolf_lobby_players
SET player_idx = :player_idx!, role = :role!
WHERE game_id = :game_id! AND public_key_hex = :public_key_hex!;

/* @name updateLobbyPlayerEvmAddress */
UPDATE werewolf_lobby_players
SET evm_address = :evm_address!
WHERE game_id = :game_id! AND public_key_hex = :public_key_hex!;

/* @name getGamesByEvmAddress */
SELECT
  wlp.game_id,
  wlp.player_idx,
  wlp.role,
  wlp.public_key_hex,
  wlp.nickname,
  wl.closed,
  wl.bundles_ready,
  wgv.phase,
  wgv.round,
  wgv.finished
FROM werewolf_lobby_players wlp
LEFT JOIN werewolf_lobby    wl  ON wlp.game_id = wl.game_id
LEFT JOIN werewolf_game_view wgv ON wlp.game_id = wgv.game_id
WHERE wlp.evm_address = :evm_address!
ORDER BY wlp.game_id DESC;
