import {
  type BatcherConfig,
  FileStorage,
  MidnightAdapter,
} from "@paimaexample/batcher";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { Contract, witnesses } from "@example-midnight/my-midnight-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";

const isEnvTrue = (key: string) =>
  ["true", "1", "yes", "y"].includes((Deno.env.get(key) || "").toLowerCase());
const midnight_enabled = !isEnvTrue("DISABLE_MIDNIGHT");

const batchIntervalMs = 1000;
const port = Number(Deno.env.get("BATCHER_PORT") ?? "3334");

// Midnight adapter configuration
const midnightContractData = midnight_enabled
  ? readMidnightContract(
    "contract-werewolf",
    { networkId: midnightNetworkConfig.id },
  )
  : null;

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

export const config: BatcherConfig = {
  pollingIntervalMs: batchIntervalMs,
  adapters: {
    // paimaL2,
    ...(midnightAdapter ? { midnight: midnightAdapter } : {}),
  },
  defaultTarget: "midnight",
  namespace: "",
  batchingCriteria: {
    ...(midnightAdapter
      ? { midnight: { criteriaType: "time", timeWindowMs: batchIntervalMs } }
      : {}),
  },
  // TODO: rename to wait-effectstream-processed
  confirmationLevel: "wait-effectstream-processed", // Connector expectation
  enableHttpServer: true,
  enableEventSystem: true,
  port,
};

export const storage = new FileStorage("./batcher-data");
