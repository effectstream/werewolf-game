-- Stores encrypted votes submitted by players per round/phase.
-- The trusted node reads these when all alive players have voted (or on timeout),
-- then submits them in batch to the Midnight contract via admin resolution circuits.
CREATE TABLE werewolf_player_votes (
  id              SERIAL   PRIMARY KEY,
  game_id         BIGINT   NOT NULL,
  round           INTEGER  NOT NULL,
  phase           TEXT     NOT NULL,          -- 'Night' | 'Day'
  voter_index     INTEGER  NOT NULL,
  encrypted_vote  TEXT     NOT NULL,          -- 3-byte ciphertext as 6 hex chars
  merkle_path     TEXT     NOT NULL,          -- JSON-serialised MerkleTreePath
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, round, phase, voter_index) -- one vote per player per round/phase
);

CREATE INDEX werewolf_player_votes_round_idx
  ON werewolf_player_votes (game_id, round, phase);
