import { serveDir } from "jsr:@std/http@^1/file-server";
import { dirname, fromFileUrl, resolve } from "jsr:@std/path@^1";

const scriptDir = dirname(fromFileUrl(import.meta.url));
const distDir = resolve(scriptDir, "../dist");
const port = Number(Deno.env.get("VITE_FRONTEND_PORT")) || 5774;

const WASM_HEADERS: Record<string, string> = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

async function handler(req: Request): Promise<Response> {
  let res = await serveDir(req, { fsRoot: distDir, quiet: true });

  if (res.status === 404) {
    const indexReq = new Request(new URL("/index.html", req.url).href, req);
    res = await serveDir(indexReq, { fsRoot: distDir, quiet: true });
  }

  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(WASM_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

console.log(`[serve-mainnet] http://0.0.0.0:${port} → ${distDir}`);
Deno.serve({ port }, handler);
