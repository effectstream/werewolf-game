import { EffectstreamL2DefaultAdapter } from "@effectstream/batcher-sdk";
import type { DefaultBatcherInput } from "@effectstream/batcher-sdk";
import { contractAddressesEvmMain } from "@werewolf-game/evm-contracts";
import { ENV } from "@effectstream/utils/node-env";
import * as chains from "viem/chains";
import process from "node:process";
import type { Chain } from "viem";
import { verifyMessage } from "viem";

// This file loads either a local hardhat chain contract, a testnet contract, or a mainnet contract.
//
// Config values mirroring e2e/client/node/scripts/start.{env}.ts
const isTestnet = ENV.EFFECTSTREAM_ENV === "testnet";
const isMainnet = ENV.EFFECTSTREAM_ENV === "mainnet";
const evm_enabled = !ENV.getBoolean("DISABLE_EVM");

const chainNameId: "chain31337" | "chain421614" | "chain42161" =
  ("chain" + (isMainnet ? 42161 : isTestnet ? 421614 : 31337)) as
    | "chain31337"
    | "chain421614"
    | "chain42161";
const paimaSyncProtocolName = "parallelEvmRPC_fast";

// Security-namespace prefix the node's L2 primitive verifies batched signatures
// against. MUST match setSecurityNamespace(...) in
// packages/shared/data-types/src/config*.ts and the frontend's SECURITY_NAMESPACE.
const SECURITY_NAMESPACE = "evm-midnight-node";

const paimaL2Address = evm_enabled
  ? contractAddressesEvmMain()[chainNameId as "chain31337"][
    "PaimaL2ContractModule#MyPaimaL2Contract"
  ] as `0x${string}`
  : `0x0`;

const batcherPrivateKey =
  (process.env.SYSTEM_PRIVATE_KEY ??
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as `0x${string}`;

// Defaults consistent with E2E usage
const paimaL2Fee = 0n; // old batcher defaulted to 0 for local dev

let chain: Chain;
if (isMainnet) {
  chain = chains.arbitrum;
  chain.rpcUrls = {
    default: {
      http: [
        ENV.getString("ARBITRUM_ONE_RPC_WRITE") ??
          ENV.getString("ARBITRUM_ONE_RPC"),
      ],
    },
  };
} else if (isTestnet) {
  chain = chains.arbitrumSepolia;
  chain.rpcUrls = {
    default: {
      http: [
        ENV.getString("ARBITRUM_SEPOLIA_RPC_WRITE") ??
          ENV.getString("ARBITRUM_SEPOLIA_RPC"),
      ],
    },
  };
} else {
  chain = chains.hardhat;
}

// PaimaL2 EVM adapter with custom signature verification — must reproduce exactly
// what the node's effectstream-l2 primitive verifies: namespace + target + ts +
// addr + input. `target` is NOT serialized into the on-chain batch, so the node
// re-verifies with target=undefined → omit it here. The namespace IS required and
// must equal the node's setSecurityNamespace (SECURITY_NAMESPACE) — omitting it
// (the old ""), made the node reject every input with "Invalid signature".
class WerewolfPaimaL2Adapter extends EffectstreamL2DefaultAdapter {
  async verifySignature(input: DefaultBatcherInput): Promise<boolean> {
    if (!input.signature) return false;
    const address = input.address.toLowerCase() as `0x${string}`;
    const message = (
      SECURITY_NAMESPACE + // must match the node L2 primitive's verify namespace
      input.timestamp +
      address +
      input.input
    )
      .replace(/[^a-zA-Z0-9]/g, "-")
      .toLocaleLowerCase();
    try {
      return await verifyMessage({
        address: input.address as `0x${string}`,
        message,
        signature: input.signature as `0x${string}`,
      });
    } catch {
      return false;
    }
  }
}

export const paimaL2Adapter: WerewolfPaimaL2Adapter = evm_enabled
  ? new WerewolfPaimaL2Adapter(
    paimaL2Address,
    batcherPrivateKey,
    paimaL2Fee,
    paimaSyncProtocolName,
    chain,
  )
  : (undefined as any);
