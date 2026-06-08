import routeStaticFilesFrom from "./util/routeStaticFilesFrom.ts";

const staticHandler = routeStaticFilesFrom([
  `${process.cwd()}/client/dist`,
  `${process.cwd()}/client/public`,
]);

// Default EVM-Midnight dApp Port
const PORT = 10599;

// If this is the entry point, start the server
if (import.meta.main) {
  Bun.serve({
    port: PORT,
    fetch: staticHandler,
  });
  console.log(
    `Server listening on port http://localhost:${PORT}`,
  );
}
