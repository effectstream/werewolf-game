-- Partial index on unresolved rounds so getStuckRounds avoids a full table
-- scan. Once a round is resolved=TRUE it falls out of the index automatically,
-- keeping it small regardless of historical row count.
CREATE INDEX IF NOT EXISTS idx_round_state_unresolved
  ON werewolf_round_state (game_id)
  WHERE resolved = FALSE;
