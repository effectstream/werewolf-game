/**
 * Preprod / Preview network orchestrator config (for the bun `@effectstream/orchestrator` CLI).
 *
 * Run with:  bunx orchestrator start scripts/start.preprod.ts   (wired via the `preprod` script)
 *
 * Key differences from the local-dev start.ts:
 *   - No EVM (Hardhat) node — we connect to Arbitrum Sepolia directly.
 *   - No Midnight node / indexer — we connect to the preprod external services.
 *   - No contract deployment — contract address is read from local JSON artifacts.
 *   - No debug explorer — not appropriate for public-facing deployments.
 *   - Local proof server can be optionally spawned (LAUNCH_PROOF_SERVER env var).
 *     When enabled, it connects to the preprod Midnight node over WS.
 *     Override the node WS URL via SUBSTRATE_NODE_WS_URL if needed.
 *
 * NOTE: For file-based logs, run the orchestrator with `--background --log-dir <dir>`.
 */

import { resolve } from "node:path";
import type { OrchestratorConfig, ProcessConfig } from "@effectstream/orchestrator/config";
import { launchPglite } from "@effectstream/orchestrator/launch-pglite";

const launchProofServer = process.env["LAUNCH_PROOF_SERVER"] !== "false";
const useExternalPg = process.env["USE_EXTERNAL_PG"] === "true";

if (!useExternalPg) {
  process.env["PGLITE"] = "true";
  process.env["DB_HOST"] = "localhost";
  process.env["DB_USER"] = "postgres";
  process.env["DB_PW"] = "postgres";
  if (process.env["DB_PORT"] === undefined) process.env["DB_PORT"] = "5432";
}

const SCRIPT_DIR = import.meta.dirname;
const NODE_DIR = resolve(SCRIPT_DIR, "..");
const MIDNIGHT_DIR = resolve(SCRIPT_DIR, "../../../shared/contracts/midnight");
const BATCHER_DIR = resolve(SCRIPT_DIR, "../../batcher");
const CHAT_SERVER_DIR = resolve(SCRIPT_DIR, "../../../chat-server");
const dbPort = Number(process.env["DB_PORT"] ?? "5432");

const proofServer: ProcessConfig[] = launchProofServer
  ? [
    {
      name: "midnight-proof-server",
      description: "Local Midnight proof server (connects to preprod node over WS)",
      cwd: MIDNIGHT_DIR,
      args: ["run", "midnight-proof-server:start:preprod"],
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:6300",
      stopProcessAtPort: [6300],
    },
  ]
  : [];

/**
 * The orchestrator spawns every process with FORCE_COLOR=true hardcoded, which
 * pollutes per-process log files (--log-dir) with ANSI escape codes. Wrap each
 * process so its actual command runs with color disabled.
 */
function stripColor(p: ProcessConfig): ProcessConfig {
  return {
    ...p,
    command: "sh",
    args: ["-c", 'FORCE_COLOR=0 NO_COLOR=1 exec "$@"', "sh", p.command ?? "bun", ...p.args],
  };
}

const config: OrchestratorConfig = {
  processes: [
    ...(useExternalPg ? [] : launchPglite({ port: dbPort })),
    ...proofServer,
    {
      name: "batcher",
      args: ["run", "start"],
      cwd: BATCHER_DIR,
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:3334",
      stopProcessAtPort: [3334],
      ...(launchProofServer ? { dependsOn: ["midnight-proof-server"] } : {}),
    },
    {
      name: "chat-server",
      args: ["run", "start"],
      cwd: CHAT_SERVER_DIR,
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:3001/health",
      stopProcessAtPort: [3001],
      env: { ENV: "production" },
    },
    {
      name: "sync",
      description: "Werewolf node sync engine (node:start:preprod)",
      args: ["run", "node:start:preprod"],
      cwd: NODE_DIR,
      waitToExit: false,
      critical: true,
      dependsOn: [
        ...(useExternalPg ? [] : ["pglite-wait"]),
        ...(launchProofServer ? ["midnight-proof-server"] : []),
      ],
    },
  ].map(stripColor),
};

export default config;
