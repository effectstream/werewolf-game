-- Persists pre-shuffled player bundles so they survive node restarts.
-- One row per bundle slot; a pop is modelled as DELETE RETURNING.
CREATE TABLE werewolf_lobby_bundles (
  id        SERIAL  PRIMARY KEY,
  game_id   BIGINT  NOT NULL,
  bundle    TEXT    NOT NULL  -- JSON-serialised PlayerBundle
);

CREATE INDEX werewolf_lobby_bundles_game_id ON werewolf_lobby_bundles (game_id);
