import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, "../dist");
const port = Number(process.env.VITE_FRONTEND_PORT) || 5774;

const WASM_HEADERS: Record<string, string> = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

function mime(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? (MIME[path.slice(dot)] ?? "application/octet-stream") : "application/octet-stream";
}

async function tryServeFile(filePath: string): Promise<Response | null> {
  try {
    await stat(filePath);
    const body = await readFile(filePath);
    return new Response(body, { headers: { "Content-Type": mime(filePath) } });
  } catch {
    return null;
  }
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filePath = resolve(distDir, "." + url.pathname);

  if (!filePath.startsWith(distDir)) {
    return new Response("Forbidden", { status: 403 });
  }

  let res = await tryServeFile(filePath);
  if (!res) {
    res = await tryServeFile(resolve(distDir, "index.html"));
    if (!res) return new Response("Not Found", { status: 404 });
  }

  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(WASM_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

console.log(`[serve-preprod] http://0.0.0.0:${port} → ${distDir}`);
Bun.serve({ port, fetch: handler });
