import { resolve } from "node:path";
import type { OrchestratorConfig, ProcessConfig } from "@effectstream/orchestrator/config";
import { launchMidnight } from "@effectstream/orchestrator/launch-midnight";
import { launchEvm } from "@effectstream/orchestrator/launch-evm";
import { launchPglite } from "@effectstream/orchestrator/launch-pglite";
import { EvmNames } from "@effectstream/orchestrator/launch-evm";
import { MidnightNames } from "@effectstream/orchestrator/launch-midnight";

/**
 * Dev orchestration config for the new (bun) `@effectstream/orchestrator` CLI.
 *
 * Run with:  bunx orchestrator start scripts/start.ts   (wired via the `dev` script)
 *
 * Local dev uses embedded PGlite by default (a `pglite` process serves it on
 * DB_PORT). Set USE_EXTERNAL_PG=true to talk to a real Postgres instead
 * (configure PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD).
 */
const useExternalPg = process.env["USE_EXTERNAL_PG"] === "true";

if (!useExternalPg) {
  process.env["PGLITE"] = "true";
  process.env["DB_HOST"] = "localhost";
  process.env["DB_USER"] = "postgres";
  process.env["DB_PW"] = "postgres";
  // Default engine port is 5432; on macOS/Homebrew a real Postgres often owns that port
  // and has no "postgres" role — wait-on succeeds against the wrong server and the node
  // fails with "role postgres does not exist". Use a dedicated port unless overridden.
  if (process.env["DB_PORT"] === undefined) {
    process.env["DB_PORT"] = "15432";
  }
  for (
    const key of [
      "PGHOST",
      "PGPORT",
      "PGDATABASE",
      "PGUSER",
      "PGPASSWORD",
      "DATABASE_URL",
    ] as const
  ) {
    delete process.env[key];
  }
}

const SCRIPT_DIR = import.meta.dirname;
const NODE_DIR = resolve(SCRIPT_DIR, "..");
const EVM_DIR = resolve(SCRIPT_DIR, "../../../shared/contracts/evm");
const MIDNIGHT_DIR = resolve(SCRIPT_DIR, "../../../shared/contracts/midnight");
const CONTRACT_WEREWOLF_DIR = resolve(MIDNIGHT_DIR, "contract-werewolf");
const BATCHER_DIR = resolve(SCRIPT_DIR, "../../batcher");
const CHAT_SERVER_DIR = resolve(SCRIPT_DIR, "../../../chat-server");

const dbPort = Number(process.env["DB_PORT"] ?? "15432");

const customProcesses: ProcessConfig[] = [
  {
    name: "explorer",
    command: "bunx",
    args: ["@effectstream/explorer"],
    cwd: NODE_DIR,
    waitToExit: false,
    type: "secondary",
    critical: false,
    link: "http://localhost:10590",
    stopProcessAtPort: [10590],
  },
  {
    name: "batcher",
    args: ["run", "start"],
    cwd: BATCHER_DIR,
    waitToExit: false,
    type: "system-dependency",
    link: "http://localhost:3334",
    stopProcessAtPort: [3334],
    dependsOn: [MidnightNames.CONTRACT_DEPLOY],
  },
  {
    name: "chat-server",
    args: ["run", "start"],
    cwd: CHAT_SERVER_DIR,
    waitToExit: false,
    type: "system-dependency",
    link: "http://localhost:3001/health",
    stopProcessAtPort: [3001],
    env: {
      ENV: "development",
    },
  },
];

/**
 * The orchestrator spawns every process with FORCE_COLOR=true hardcoded, which
 * pollutes the per-process log files (--log-dir) with ANSI escape codes. Wrap
 * each process so its actual command runs with color disabled. Only the child
 * output (→ log files) is affected; the orchestrator's own status UI stays colored.
 */
function stripColor(p: ProcessConfig): ProcessConfig {
  return {
    ...p,
    command: "sh",
    args: ["-c", 'FORCE_COLOR=0 NO_COLOR=1 exec "$@"', "sh", p.command ?? "bun", ...p.args],
  };
}

// Compile the Compact contract (+ ZK verifier keys) before deploying it.
// launchMidnight() does NOT compile (unlike launchEvm), so wire it in for parity
// and make the midnight-contract deploy depend on it. The compact compiler is
// incremental, so this is cheap on unchanged contracts.
const compileMidnightContract: ProcessConfig = {
  name: "compile-midnight-contract",
  description: "Compile the Compact contract + generate ZK verifier keys",
  cwd: CONTRACT_WEREWOLF_DIR,
  args: ["run", "compact"],
  waitToExit: true,
  critical: true,
};

const midnightProcesses = launchMidnight(
  "@example-midnight/midnight-contracts",
  { cwd: MIDNIGHT_DIR },
).map((p) =>
  p.name === MidnightNames.CONTRACT_DEPLOY
    ? { ...p, dependsOn: [...(p.dependsOn ?? []), compileMidnightContract.name] }
    : p
);

const config: OrchestratorConfig = {
  processes: [
    ...(useExternalPg ? [] : launchPglite({ port: dbPort })),
    ...launchEvm("@werewolf-game/evm-contracts", { cwd: EVM_DIR }),
    compileMidnightContract,
    ...midnightProcesses,
    ...customProcesses,
    {
      // The Effectstream sync engine — the werewolf node itself.
      name: "sync",
      description: "Werewolf node sync engine (node:start)",
      args: ["run", "node:start"],
      cwd: NODE_DIR,
      waitToExit: false,
      critical: true,
      dependsOn: [
        ...(useExternalPg ? [] : ["pglite-wait"]),
        EvmNames.GENERATE_MOD,
        MidnightNames.CONTRACT_DEPLOY,
      ],
    },
  ].map(stripColor),
};

export default config;
