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
import { config as nodeConfig } from "@werewolf-game/data-types/config.mainnet";
import {
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@paimaexample/config";
import { migrationTable } from "@werewolf-game/database";
import { grammar } from "@werewolf-game/data-types/grammar";
import { gameStateTransitions } from "./state-machine.ts";
import { apiRouter } from "./api.preprod.ts";

main(function* () {
  yield* init();
  console.log("Starting EffectStream Node (Mainnet)");

  yield* withEffectstreamStaticConfig(nodeConfig, function* () {
    yield* start({
      appName: "evm-midnight-example",
      appVersion: "0.3.21",
      syncInfo: toSyncProtocolWithNetwork(nodeConfig),
      gameStateTransitions,
      migrations: migrationTable,
      apiRouter,
      grammar,
    });
  });

  yield* suspend();
});
