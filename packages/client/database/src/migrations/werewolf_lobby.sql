-- Tracks EVM lobby state for timeout enforcement
CREATE TABLE werewolf_lobby (
  game_id                BIGINT  NOT NULL PRIMARY KEY,
  max_players            BIGINT  NOT NULL,
  player_count           BIGINT  NOT NULL DEFAULT 0,
  created_block          BIGINT  NOT NULL,
  timeout_block          BIGINT,
  closed                 BOOLEAN NOT NULL DEFAULT FALSE,
  bundles_ready          BOOLEAN NOT NULL DEFAULT FALSE,
  admin_sign_public_key  TEXT             -- Ed25519 public key (hex) for votes_for_round auth
);

-- Lobby player list populated on join_game state transitions
CREATE TABLE werewolf_lobby_players (
  game_id               BIGINT NOT NULL,
  public_key_hex        TEXT    NOT NULL,
  nickname              TEXT    NOT NULL,
  joined_block          BIGINT NOT NULL,
  PRIMARY KEY (game_id, public_key_hex)
);

-- Auto-lobby sequence counter
CREATE TABLE werewolf_lobby_sequence (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  last_game_id  BIGINT NOT NULL DEFAULT 0
);
INSERT INTO werewolf_lobby_sequence (last_game_id) VALUES (0);
