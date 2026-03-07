import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import deno from "@deno/vite-plugin";

export default defineConfig({
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
