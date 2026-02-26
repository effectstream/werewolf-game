import {
  type BatcherConfig,
  FileStorage,
  MidnightAdapter,
} from "@paimaexample/batcher";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { Contract, witnesses } from "@example-midnight/my-midnight-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import { WerewolfBalancingAdapter } from "./adapters/werewolf-balancing-adapter.ts";
import { paimaL2Adapter } from "./adapters/adapter-paimaL2.ts";
import * as path from "@std/path";

const isEnvTrue = (key: string) =>
  ["true", "1", "yes", "y"].includes((Deno.env.get(key) || "").toLowerCase());
const midnight_enabled = !isEnvTrue("DISABLE_MIDNIGHT");

const batchIntervalMs = 1000;
const port = Number(Deno.env.get("BATCHER_PORT") ?? "3334");

// Try to load contract data (needed for the standard midnight adapter).
// May fail if the contract hasn't been deployed yet (no address JSON file).
let midnightContractData: ReturnType<typeof readMidnightContract> | null = null;
if (midnight_enabled) {
  try {
    midnightContractData = readMidnightContract(
      "contract-werewolf",
      { networkId: midnightNetworkConfig.id },
    );
  } catch (e) {
    console.warn(
      `⚠️  Could not load contract address file: ${(e as Error).message}`,
    );
    console.warn(
      "   The standard midnight adapter will be disabled. " +
        "The midnight_balancing adapter (for delegated tx) will still work.",
    );
  }
}

// Resolve zkConfigPath for the balancing adapter independently of the address file.
// The balancing adapter only needs the ZK keys/ZKIR, not the contract address.
const zkConfigPath = midnightContractData?.zkConfigPath ??
  path.resolve(
    import.meta.dirname!,
    "..",
    "..",
    "shared",
    "contracts",
    "midnight",
    "contract-werewolf",
    "src",
    "managed",
  );

const midnightAdapter = midnightContractData
  ? new MidnightAdapter(
    midnightContractData.contractAddress,
    midnightNetworkConfig.walletSeed!,
    {
      indexer: midnightNetworkConfig.indexer,
      indexerWS: midnightNetworkConfig.indexerWS,
      node: midnightNetworkConfig.node,
      proofServer: midnightNetworkConfig.proofServer,
      zkConfigPath: midnightContractData.zkConfigPath,
      privateStateStoreName: "counter-private-state",
      privateStateId: "counterPrivateState",
      contractJoinTimeoutSeconds: 300,
      walletFundingTimeoutSeconds: 300,
      walletNetworkId: midnightNetworkConfig.id,
    },
    new Contract.Contract(witnesses),
    witnesses,
    midnightContractData.contractInfo,
    "parallelMidnight",
  )
  : undefined;

// The balancing adapter handles delegated transactions from BatcherClient.
const midnightBalancingAdapter = midnight_enabled
  ? new WerewolfBalancingAdapter(
    midnightNetworkConfig.walletSeed!,
    {
      indexer: midnightNetworkConfig.indexer,
      indexerWS: midnightNetworkConfig.indexerWS,
      node: midnightNetworkConfig.node,
      proofServer: midnightNetworkConfig.proofServer,
      zkConfigPath,
      walletNetworkId: midnightNetworkConfig.id,
    },
  )
  : undefined;

export const config: BatcherConfig = {
  pollingIntervalMs: batchIntervalMs,
  adapters: {
    paimaL2: paimaL2Adapter,
    ...(midnightAdapter ? { midnight: midnightAdapter } : {}),
    ...(midnightBalancingAdapter
      ? { midnight_balancing: midnightBalancingAdapter }
      : {}),
  },
  defaultTarget: midnightAdapter ? "midnight" : "midnight_balancing",
  namespace: "",
  batchingCriteria: {
    ...(midnightAdapter
      ? { midnight: { criteriaType: "time", timeWindowMs: batchIntervalMs } }
      : {}),
    ...(midnightBalancingAdapter
      ? {
        midnight_balancing: {
          criteriaType: "time",
          timeWindowMs: batchIntervalMs,
        },
      }
      : {}),
  },
  confirmationLevel: "wait-effectstream-processed", // Connector expectation
  enableHttpServer: true,
  enableEventSystem: true,
  port,
};

export const storage = new FileStorage("./batcher-data");
