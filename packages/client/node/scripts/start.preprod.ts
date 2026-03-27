/**
 * Preprod / Preview network orchestrator.
 *
 * Key differences from the local-dev start.ts:
 *   - No EVM (Hardhat) node — we connect to Arbitrum Sepolia directly.
 *   - No Midnight node / indexer — we connect to the preprod external services.
 *   - No contract deployment — contract address is read from local JSON artifacts.
 *   - No debug explorer — not appropriate for public-facing deployments.
 *   - Logs to stdout by default (no TMUX / TUI) — suitable for server environments.
 *   - Local proof server can be optionally spawned (controlled by LAUNCH_PROOF_SERVER env var).
 *     When enabled, it connects to the preprod Midnight node over WS.
 *     Override the node WS URL via SUBSTRATE_NODE_WS_URL if needed.
 */

import { OrchestratorConfig, start } from "@paimaexample/orchestrator";
import { ComponentNames } from "@paimaexample/log";
import { Value } from "@sinclair/typebox/value";

// Read the LAUNCH_PROOF_SERVER environment variable (default: true)
const launchProofServer = Deno.env.get("LAUNCH_PROOF_SERVER") !== "false";

// Read the USE_EXTERNAL_PG environment variable (default: false - use embedded PGLite)
// Set to "true" in .env.preprod to use external PostgreSQL instead
const useExternalPg = Deno.env.get("USE_EXTERNAL_PG") === "true";

const customProcesses = [
  ...(launchProofServer
    ? [
        {
          // Local proof server — connects to the preprod Midnight node over WS.
          // Both the batcher and the node use this for circuit proving.
          // Override SUBSTRATE_NODE_WS_URL in .env if your preprod endpoint differs.
          name: "midnight-proof-server",
          args: [
            "task",
            "-f",
            "@example-midnight/midnight-contracts",
            "midnight-proof-server:start:preprod",
          ],
          waitToExit: false,
          type: "system-dependency",
          link: "http://localhost:6300",
          stopProcessAtPort: [6300],
        },
      ]
    : []),
  {
    name: "batcher",
    args: ["task", "-f", "@example-midnight/batcher", "start"],
    waitToExit: false,
    type: "system-dependency",
    link: "http://localhost:3334",
    stopProcessAtPort: [3334],
    // Batcher proves circuits — wait for the proof server to be ready first.
    ...(launchProofServer ? { dependsOn: ["midnight-proof-server"] } : {}),
  },
  {
    name: "chat-server",
    args: ["task", "-f", "@werewolf-game/chat-server", "start"],
    waitToExit: false,
    type: "system-dependency",
    link: "http://localhost:3001/health",
    stopProcessAtPort: [3001],
    env: {
      ENV: "production",
    },
  },
];

const config = Value.Parse(OrchestratorConfig, {
  packageName: "jsr:@paimaexample",
  processes: {
    // No TMUX / TUI — run as a plain server process.
    [ComponentNames.TMUX]: false,
    [ComponentNames.TUI]: false,
    // DB: Use embedded PGLite (default) or external PostgreSQL (if USE_EXTERNAL_PG=true)
    // External PostgreSQL requires PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD env vars
    [ComponentNames.EFFECTSTREAM_PGLITE]: !useExternalPg,
    [ComponentNames.COLLECTOR]: true,
  },

  processesToLaunch: [
    // NOTE: launchEvm() and launchMidnight() are intentionally omitted.
    // We rely on external Arbitrum Sepolia RPC and Midnight preprod services.
    ...customProcesses,
  ],

  // Always log to stdout in preprod.
  logs: "stdout",
});

await start(config);
