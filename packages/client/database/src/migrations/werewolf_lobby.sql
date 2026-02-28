-- Tracks EVM lobby state for timeout enforcement
CREATE TABLE werewolf_lobby (
  game_id       BIGINT NOT NULL PRIMARY KEY,
  max_players   BIGINT NOT NULL,
  player_count  BIGINT NOT NULL DEFAULT 0,
  created_block BIGINT NOT NULL,
  timeout_block BIGINT,
  closed        BOOLEAN NOT NULL DEFAULT FALSE
);

-- Lobby player list populated on join_game state transitions
CREATE TABLE werewolf_lobby_players (
  game_id               BIGINT NOT NULL,
  midnight_address_hash TEXT    NOT NULL,
  nickname              TEXT    NOT NULL,
  joined_block          BIGINT NOT NULL,
  PRIMARY KEY (game_id, midnight_address_hash)
);
