-- Tracks the state of each game round for vote timeout enforcement
CREATE TABLE werewolf_round_state (
  game_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  phase TEXT NOT NULL,
  alive_count INTEGER NOT NULL DEFAULT 0,
  votes_submitted INTEGER NOT NULL DEFAULT 0,
  round_started_block INTEGER NOT NULL,
  timeout_block INTEGER,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (game_id, round, phase)
);

-- Snapshot of alive player indices at the start of each round (used to determine who to punish on timeout)
CREATE TABLE werewolf_alive_snapshot (
  game_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  phase TEXT NOT NULL,
  player_idx INTEGER NOT NULL,
  PRIMARY KEY (game_id, round, phase, player_idx)
);

-- Pending player punishments to be dispatched to the Midnight contract by the admin
CREATE TABLE werewolf_pending_punishments (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL,
  player_idx INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'vote_timeout',
  created_at_block INTEGER NOT NULL,
  executed BOOLEAN NOT NULL DEFAULT FALSE
);
