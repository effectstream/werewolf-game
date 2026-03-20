-- Maps EVM addresses to their proxy Midnight addresses, and optionally
-- to claimed real Lace Midnight addresses.
-- One row per EVM address; completely replicable from on-chain register_proxy_wallet
-- and claim_real_wallet grammar inputs.
CREATE TABLE werewolf_wallet_mapping (
  evm_address            TEXT   NOT NULL PRIMARY KEY,
  proxy_midnight_address TEXT   NOT NULL,
  real_midnight_address  TEXT,               -- NULL until claim_real_wallet
  registered_block       BIGINT NOT NULL,
  claimed_block          BIGINT              -- NULL until claim_real_wallet
);

-- Index to look up by proxy address (used during leaderboard migration on claim)
CREATE INDEX idx_wallet_mapping_proxy ON werewolf_wallet_mapping (proxy_midnight_address);
