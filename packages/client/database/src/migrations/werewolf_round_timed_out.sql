-- Marks a round whose werewolfRoundTimeout STF fired and took the punishment
-- path (votes_submitted < alive_count). Lets the background resolution-retry
-- loop detect timeout-path resolutions that failed asynchronously, which the
-- votes_submitted >= alive_count heuristic in getStuckRounds cannot catch.
ALTER TABLE werewolf_round_state
  ADD COLUMN IF NOT EXISTS timed_out BOOLEAN NOT NULL DEFAULT FALSE;
