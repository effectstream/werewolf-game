// NOTE & TODO:
// Importing "@midnight-ntwrk/onchain-runtime" here is a workaround.
// Loading this package in a dependency makes the onchain-runtime wasm
// fail in runtime when trying to parse the state.
// The next line is so that the wasm is loaded and not optimized away.
import "@midnight-ntwrk/onchain-runtime";

import { init, start } from "@paimaexample/runtime";
import { main, suspend } from "effection";
import { config as nodeConfig } from "@werewolf-game/data-types/config";
import {
  type SyncProtocolWithNetwork,
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@paimaexample/config";
import { migrationTable } from "@werewolf-game/database";
import { grammar } from "@werewolf-game/data-types/grammar";
import { gameStateTransitions } from "./state-machine.ts";
import { apiRouter } from "./api.ts";

main(function* () {
  yield* init();
  console.log("Starting EffectStream Node (Local)");

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
