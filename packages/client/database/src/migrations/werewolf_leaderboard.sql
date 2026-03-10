-- Cumulative leaderboard keyed by EVM address, accumulated across game sessions.
-- Rebuilt automatically on node restart by replaying historical blocks.
CREATE TABLE werewolf_leaderboard (
  evm_address        TEXT   NOT NULL PRIMARY KEY,
  total_points       BIGINT NOT NULL DEFAULT 0,
  games_played       INT    NOT NULL DEFAULT 0,
  games_won          INT    NOT NULL DEFAULT 0,
  rounds_survived    INT    NOT NULL DEFAULT 0,
  last_updated_block BIGINT
);
