import { PaimaL2DefaultAdapter } from "@paimaexample/batcher";
import type { DefaultBatcherInput } from "@paimaexample/batcher";
import { contractAddressesEvmMain } from "@werewolf-game/evm-contracts";
import { ENV } from "@paimaexample/utils/node-env";
import * as chains from "viem/chains";
import type { Chain } from "viem";
import { verifyMessage } from "viem";

// This file loads either a local hardhat chain contract or a testnet contract.
//
// Config values mirroring e2e/client/node/scripts/start.{env}.ts
const isTestnet = ENV.EFFECTSTREAM_ENV === "testnet";
const evm_enabled = !ENV.getBoolean("DISABLE_EVM");

const chainNameId: "chain31338" | "chain31337" | "chain421614" =
  ("chain" + (isTestnet ? 421614 : 31337)) as
    | "chain31337"
    | "chain421614";
const paimaSyncProtocolName = "parallelEvmRPC_fast";

const paimaL2Address = evm_enabled
  ? contractAddressesEvmMain()[chainNameId as "chain31337"][
    "PaimaL2ContractModule#MyPaimaL2Contract"
  ] as `0x${string}`
  : `0x0`;

const batcherPrivateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// Defaults consistent with E2E usage
const paimaL2Fee = 0n; // old batcher defaulted to 0 for local dev

let chain: Chain;
if (isTestnet) {
  chain = chains.arbitrumSepolia;
  chain.rpcUrls = {
    default: {
      http: [ENV.getString("ARBITRUM_SEPOLIA_RPC")],
    },
  };
} else {
  chain = chains.hardhat;
}

// PaimaL2 EVM adapter with custom signature verification.
// The default batcher verification includes `target` in the signed message, but
// the L2 primitive re-verifies on-chain without `target` (it's not stored in the
// batch). Both sides must agree, so we omit `target` from the message here too.
class WerewolfPaimaL2Adapter extends PaimaL2DefaultAdapter {
  async verifySignature(input: DefaultBatcherInput): Promise<boolean> {
    if (!input.signature) return false;
    const address = input.address.toLowerCase() as `0x${string}`;
    const message = (
      "" + // namespace (matches batcher config namespace: "")
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
    batcherPrivateKey as `0x${string}`,
    paimaL2Fee,
    paimaSyncProtocolName,
    chain,
  )
  : (undefined as any);
