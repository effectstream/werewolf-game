-- Denormalized game view upserted on every Midnight ledger update.
-- One row per game. Designed for fast polling reads by the frontend.
CREATE TABLE werewolf_game_view (
  game_id          BIGINT  NOT NULL PRIMARY KEY,
  phase            TEXT    NOT NULL DEFAULT 'day',
  round            INTEGER NOT NULL DEFAULT 0,
  player_count     INTEGER NOT NULL DEFAULT 0,
  alive_count      INTEGER NOT NULL DEFAULT 0,
  werewolf_count   INTEGER NOT NULL DEFAULT 0,
  villager_count   INTEGER NOT NULL DEFAULT 0,
  alive_vector     TEXT    NOT NULL DEFAULT '[]',
  finished         BOOLEAN NOT NULL DEFAULT FALSE,
  werewolf_indices TEXT    NOT NULL DEFAULT '[]',
  updated_block    BIGINT  NOT NULL DEFAULT 0
);
