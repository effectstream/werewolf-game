import {
  type BatcherConfig,
  FileStorage,
  MidnightBalancingAdapterConfig,
} from "@effectstream/batcher-sdk";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { WerewolfBalancingAdapter } from "./adapters/werewolf-balancing-adapter.ts";
import { paimaL2Adapter } from "./adapters/adapter-paimaL2.ts";

const isEnvTrue = (key: string) =>
  ["true", "1", "yes", "y"].includes((process.env[key] || "").toLowerCase());
const midnight_enabled = !isEnvTrue("DISABLE_MIDNIGHT");

const batchIntervalMs = 1000;
const port = Number(process.env["BATCHER_PORT"] ?? "3334");

// Support multiple batcher wallets via comma-separated MIDNIGHT_WALLET_SEED.
// Each wallet maintains its own dust UTXOs; total batch capacity = maxBatchSize × walletCount.
const walletSeeds = midnightNetworkConfig.walletSeed!
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// The balancing adapter handles delegated transactions from BatcherClient.
const midnightBalancingAdapter = midnight_enabled
  ? new WerewolfBalancingAdapter(
    walletSeeds,
    {
      indexer: midnightNetworkConfig.indexer,
      indexerWS: midnightNetworkConfig.indexerWS,
      node: midnightNetworkConfig.node,
      proofServer: midnightNetworkConfig.proofServer,
      walletNetworkId: midnightNetworkConfig.id,
      addShieldedPadding: false,
    } as MidnightBalancingAdapterConfig,
  )
  : undefined;

export const config: BatcherConfig = {
  pollingIntervalMs: batchIntervalMs,
  adapters: {
    ...(paimaL2Adapter ? { paimaL2: paimaL2Adapter } : {}),
    ...(midnightBalancingAdapter
      ? { midnight_balancing: midnightBalancingAdapter }
      : {}),
  },
  defaultTarget: "midnight_balancing",
  namespace: "",
  batchingCriteria: {
    ...(midnightBalancingAdapter
      ? {
        midnight_balancing: {
          criteriaType: "time",
          timeWindowMs: batchIntervalMs,
        },
      }
      : {}),
  },
  confirmationLevel: "wait-receipt", // default fallback; MQTT (wait-effectstream-processed) is unavailable while MQTT_BROKER=false
  enableHttpServer: true,
  enableEventSystem: true,
  port,
};

export const storage = new FileStorage("./batcher-data");
