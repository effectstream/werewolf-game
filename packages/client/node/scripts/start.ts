import { OrchestratorConfig, start } from "@paimaexample/orchestrator";
import { ComponentNames } from "@paimaexample/log";
import { Value } from "@sinclair/typebox/value";
import { launchMidnight } from "@paimaexample/orchestrator/start-midnight";
import { launchEvm } from "@paimaexample/orchestrator/start-evm";

/**
 * Local dev uses embedded PGlite by default (orchestrator spawns it on DB_PORT).
 * Set USE_EXTERNAL_PG=true if you intentionally use a real Postgres server
 * (configure PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD).
 *
 * Without this block, a shell profile or repo-root .env can set PGLITE=false,
 * DB_HOST to a remote host, or libpq vars so the node talks to Postgres instead.
 */
const useExternalPg = Deno.env.get("USE_EXTERNAL_PG") === "true";

if (!useExternalPg) {
  Deno.env.set("PGLITE", "true");
  Deno.env.set("DB_HOST", "localhost");
  Deno.env.set("DB_USER", "postgres");
  Deno.env.set("DB_PW", "postgres");
  // Default engine port is 5432; on macOS/Homebrew a real Postgres often owns that port
  // and has no "postgres" role — wait-on succeeds against the wrong server and the node
  // fails with "role postgres does not exist". Use a dedicated port unless overridden.
  if (Deno.env.get("DB_PORT") === undefined) {
    Deno.env.set("DB_PORT", "15432");
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
    Deno.env.delete(key);
  }
}

const customProcesses = [
  // {
  //   name: "frontend-build",
  //   args: ["task", "-f", "@example-midnight/frontend", "build"],
  //   waitToExit: true,
  //   type: "system-dependency",
  //   dependsOn: [ComponentNames.DEPLOY_EVM_CONTRACTS, ComponentNames.MIDNIGHT_CONTRACT],
  // },
  // {
  //   name: "frontend-server",
  //   args: ["task", "-f", "@example-midnight/frontend", "serve"],
  //   waitToExit: false,
  //   type: "system-dependency",
  //   link: "http://localhost:10599",
  //   stopProcessAtPort: [10599],
  //   dependsOn: ["frontend-build"],
  // },
  {
    name: "explorer",
    args: ["run", "-A", "--unstable-detect-cjs", "@paimaexample/explorer"],
    waitToExit: false,
    type: "system-dependency",
    link: "http://localhost:10590",
    stopProcessAtPort: [10590],
  },
  {
    name: "batcher",
    args: ["task", "-f", "@example-midnight/batcher", "start"],
    waitToExit: false,
    type: "system-dependency",
    link: "http://localhost:3334",
    stopProcessAtPort: [3334],
    dependsOn: [ComponentNames.MIDNIGHT_CONTRACT],
  },
  {
    name: "chat-server",
    args: ["task", "-f", "@werewolf-game/chat-server", "start"],
    waitToExit: false,
    type: "system-dependency",
    link: "http://localhost:3001/health",
    stopProcessAtPort: [3001],
    env: {
      ENV: "development",
    },
  },
];

const config = Value.Parse(OrchestratorConfig, {
  // Launch system processes
  packageName: "jsr:@paimaexample",
  processes: {
    [ComponentNames.TMUX]: true,
    [ComponentNames.TUI]: true,
    // Launch Dev DB & Collector (skip PGlite spawn when USE_EXTERNAL_PG=true)
    [ComponentNames.EFFECTSTREAM_PGLITE]: !useExternalPg,
    [ComponentNames.COLLECTOR]: true,
  },

  // Launch my processes
  processesToLaunch: [
    ...launchEvm("@werewolf-game/evm-contracts"),
    ...launchMidnight("@example-midnight/midnight-contracts").map((p) => ({
      ...p,
      logsStartDisabled: false,
    })),
    ...customProcesses,
  ],
});

if (Deno.env.get("EFFECTSTREAM_STDOUT")) {
  config.logs = "stdout";
  config.processes[ComponentNames.TMUX] = false;
  config.processes[ComponentNames.TUI] = false;
  config.processes[ComponentNames.COLLECTOR] = false;
}

await start(config);
