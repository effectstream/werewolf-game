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
      contractName: "contract-werewolf",
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
      walletNetworkId: midnightNetworkConfig.id,
      addShieldedPadding: true,
      shieldedPaddingTokenID: "0000000000000000000000000000000000000000000000000000000000000000",
      maxBatchSize: 2,
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
