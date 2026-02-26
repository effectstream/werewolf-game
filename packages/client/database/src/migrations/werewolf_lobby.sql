-- Tracks EVM lobby state for timeout enforcement
CREATE TABLE werewolf_lobby (
  game_id       INTEGER NOT NULL PRIMARY KEY,
  max_players   INTEGER NOT NULL,
  player_count  INTEGER NOT NULL DEFAULT 0,
  created_block INTEGER NOT NULL,
  timeout_block INTEGER,
  closed        BOOLEAN NOT NULL DEFAULT FALSE
);

-- Lobby player list populated on join_game state transitions
CREATE TABLE werewolf_lobby_players (
  game_id               INTEGER NOT NULL,
  midnight_address_hash TEXT    NOT NULL,
  joined_block          INTEGER NOT NULL,
  PRIMARY KEY (game_id, midnight_address_hash)
);
