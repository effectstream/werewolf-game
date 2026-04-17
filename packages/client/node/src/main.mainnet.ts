/**
 * Mainnet network entry point.
 *
 * Differences from main.ts (local dev):
 *   - Uses config.mainnet for Arbitrum One + Midnight mainnet network config.
 *   - Uses api.preprod — no faucet, no debug, no admin endpoints.
 */

// NOTE: Importing "@midnight-ntwrk/onchain-runtime" here is a workaround.
// Loading this package in a dependency makes the onchain-runtime wasm
// fail at runtime when trying to parse the state.
// The next line ensures the wasm is loaded and not optimized away.
import "@midnight-ntwrk/onchain-runtime";

import { init, start } from "@paimaexample/runtime";
import { main, suspend } from "effection";
import { log } from "@paimaexample/log";
import { config as nodeConfig } from "@werewolf-game/data-types/config.mainnet";
import {
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@paimaexample/config";
import { migrationTable } from "@werewolf-game/database";
import { grammar } from "@werewolf-game/data-types/grammar";
import { gameStateTransitions } from "./state-machine.ts";
import { apiRouter } from "./api.preprod.ts";

// Route `log.remote(...)` events to the local tslog transport so that
// sync-protocol errors (EFFECTSTREAM_SYNC `readData` failures, etc.) actually
// show up in stdout / `journalctl --user -u werewolf-node-mainnet`.
//
// Without this, `log.remote` is wired to OpenTelemetry's `otelLog`, and since
// we run `main.mainnet.ts` directly (no orchestrator, no OTel collector
// attached), the error payloads are silently dropped. Only the
// `consecutiveErrors` counter in the heartbeat survives — making it
// impossible to diagnose why a sync protocol is stuck.
log.remote = log.localForce;

main(function* () {
  yield* init();
  console.log("\n🚀 Starting EffectStream Node (Mainnet)\n");

  yield* withEffectstreamStaticConfig(nodeConfig, function* () {
    yield* start({
      appName: "evm-midnight-example",
      appVersion: "0.3.21",
      syncInfo: toSyncProtocolWithNetwork(nodeConfig),
      gameStateTransitions,
      migrations: migrationTable,
      apiRouter,
      grammar,
      snapshotConfig: {},
    });
  });

  yield* suspend();
});
