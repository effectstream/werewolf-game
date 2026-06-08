import { join } from "node:path";

// Serve static files (Vite build output + public folder) with SPA fallback.
// Returns a Bun.serve-compatible fetch handler.
export default function routeStaticFilesFrom(staticPaths: string[]) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    // 1) Try to serve the exact requested file from any static path.
    for (const root of staticPaths) {
      const file = Bun.file(join(root, pathname));
      if (await file.exists()) return new Response(file);
    }

    // 2) SPA fallback: serve index.html from the first path that has it.
    for (const root of staticPaths) {
      const index = Bun.file(join(root, "index.html"));
      if (await index.exists()) return new Response(index);
    }

    return new Response("Not found", { status: 404 });
  };
}
