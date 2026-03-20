/* @name upsertWalletMapping */
INSERT INTO werewolf_wallet_mapping (evm_address, proxy_midnight_address, registered_block)
VALUES (:evm_address!, :proxy_midnight_address!, :registered_block!)
ON CONFLICT (evm_address) DO NOTHING;

/* @name getWalletMappingByEvm */
SELECT evm_address, proxy_midnight_address, real_midnight_address, claimed_block
FROM werewolf_wallet_mapping
WHERE evm_address = :evm_address!;

/* @name getWalletMappingByProxy */
SELECT evm_address, proxy_midnight_address, real_midnight_address, claimed_block
FROM werewolf_wallet_mapping
WHERE proxy_midnight_address = :proxy_midnight_address!;

/* @name claimRealWallet */
UPDATE werewolf_wallet_mapping
SET real_midnight_address = :real_midnight_address!,
    claimed_block          = :claimed_block!
WHERE evm_address = :evm_address!
  AND real_midnight_address IS NULL;
