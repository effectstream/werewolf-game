import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import deno from "@deno/vite-plugin";

// Suppress noisy proxy AbortErrors when running under Deno
// https://github.com/denoland/deno/issues/28850
const logger = createLogger();
const originalError = logger.error;
logger.error = (msg, options) => {
  const s = typeof msg === "string" ? msg : String(msg ?? "");
  const opts = options as { error?: Error } | undefined;
  const errMsg = opts?.error?.message ?? "";
  const full = s + errMsg;
  if (
    s.includes("http proxy error") &&
    (full.includes("AbortError") || full.includes("cancelled"))
  ) {
    return;
  }
  originalError(msg, options);
};

export default defineConfig({
  customLogger: logger,
  root: "./client",
  server: {
    port: 10599,
    proxy: {
      "/api": "http://localhost:9999",
    },
  },
  plugins: [react(), deno()],
  build: {
    target: "esnext",
    outDir: "../dist",
  },
});
