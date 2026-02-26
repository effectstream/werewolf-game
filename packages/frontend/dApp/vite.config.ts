import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import deno from "@deno/vite-plugin";
import nodePolyfills from "vite-plugin-node-stdlib-browser";
import wasm from "vite-plugin-wasm";
import "react";
import "react-dom";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { normalizePath } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const midnightContractsDir = path.resolve(
  configDir,
  "..",
  "..",
  "shared",
  "contracts",
  "midnight",
);

export default defineConfig({
  root: "./client",

  resolve: {
    dedupe: [
      "@midnight-ntwrk/onchain-runtime-v2",
      "@midnight-ntwrk/onchain-runtime",
      "@midnight-ntwrk/compact-runtime",
      "@midnight-ntwrk/midnight-js-contracts",
      "@midnight-ntwrk/ledger-v7",
    ],
    alias: {
      // Fix for: Module "npm:@scope/package@version" has been externalized for browser compatibility.
      //          Cannot access "npm:@scope/package@version.__esModule" in client code
      "npm:@polkadot/extension-dapp@^0.61.7": "@polkadot/extension-dapp",
      "npm:@foxglove/crc@^1.0.1": "@foxglove/crc",
      "./@polkadot/util": "npm:@polkadot/util-crypto",
      "./@polkadot/util-crypto": "npm:@polkadot/util-crypto",
      "npm:@polkadot/util-crypto@^13.4.3": "@polkadot/util-crypto",
      "npm:@polkadot/util@^13.4.3": "@polkadot/util",
      "npm:@polkadot/util-crypto@^13.5.6": "@polkadot/util-crypto",
      "npm:@polkadot/util@^13.5.6": "@polkadot/util",
      "npm:@sinclair/typebox@^0.34.41": "@sinclair/typebox",
      "npm:@sinclair/typebox@0.34.41": "@sinclair/typebox",
      "npm:/@sinclair/typebox@^0.34.41/value": "@sinclair/typebox/value",
      "npm:/@sinclair/typebox@0.34.41/value": "@sinclair/typebox/value",
      "npm:@sinclair/typebox@^0.34.41/value": "@sinclair/typebox/value",
      "npm:@sinclair/typebox@0.34.41/value": "@sinclair/typebox/value",
      "npm:/@sinclair/typebox@~0.34.41/value": "@sinclair/typebox/value",
      "npm:@sinclair/typebox@^0.34.30": "@sinclair/typebox",
      "npm:/@sinclair/typebox@^0.34.30/value": "@sinclair/typebox/value",
      "npm:@sinclair/typebox@^0.34.30/value": "@sinclair/typebox/value",
      "npm:/@sinclair/typebox@~0.34.30/value": "@sinclair/typebox/value",
      "npm:@cardano-foundation/cardano-verify-datasignature@^1.0.11": "@cardano-foundation/cardano-verify-datasignature",
      "npm:@cardano-foundation/cardano-verify-datasignature@1.0.11": "@cardano-foundation/cardano-verify-datasignature",
      "npm:viem": "viem",
      "npm:viem/accounts": "viem/accounts",
      "npm:viem@2.37.3": "viem",
      "npm:viem@2.37.3/accounts": "viem/accounts",
      "npm:/viem@2.37.3/accounts": "viem/accounts",
      "npm:@dcspark/cip34-js@3.0.1": "@dcspark/cip34-js",
      "npm:@dcspark/carp-client@^3.3.0": "@dcspark/carp-client",
      "npm:@subsquid/ss58-codec@^1.2.3": "@subsquid/ss58-codec",
      "npm:@scure/bip39@^2.0.1": "@scure/bip39",
      // Keep Midnight runtime/types as singletons across npm: and bare imports.
      "npm:@midnight-ntwrk/onchain-runtime-v2@2.0.0":
        "@midnight-ntwrk/onchain-runtime-v2",
      "@midnight-ntwrk/onchain-runtime": "@midnight-ntwrk/onchain-runtime-v2",
      "npm:@midnight-ntwrk/compact-runtime@0.14.0":
        "@midnight-ntwrk/compact-runtime",
      "npm:@midnight-ntwrk/midnight-js-contracts@3.0.0":
        "@midnight-ntwrk/midnight-js-contracts",
      "npm:@midnight-ntwrk/ledger-v7@7.0.0": "@midnight-ntwrk/ledger-v7",
    },
  },

  // optimizeDeps: {
  //
  // },
  build: {
    target: "esnext",
    minify: false,
    // sourcemap: true,
    commonjsOptions: {
      // Transform CommonJS to ESM more aggressively
      transformMixedEsModules: true,
      extensions: [".js", ".cjs"],
      // Needed for Node.js modules
      ignoreDynamicRequires: true,
    },
  },
  server: {
    port: 4001,
    open: true,
  },
  plugins: [
    react(),
    deno(),
    nodePolyfills({
      overrides: {
        // Since `fs` is not supported in browsers, we can use the `memfs` package to polyfill it.
        fs: "memfs",
        "node:fs": "memfs",
        "fs/promises": "memfs",
        "node:fs/promises": "memfs",
      },
    }),
    // topLevelAwait(),
    wasm(),
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(
            path.resolve(
              midnightContractsDir,
              "contract-werewolf",
              "src",
              "managed",
              "keys",
              "*",
            ),
          ),
          // src: "src/contract-round-value/src/managed/counter/keys/*",
          dest: "keys",
        },
        {
          src: normalizePath(
            path.resolve(
              midnightContractsDir,
              "contract-werewolf",
              "src",
              "managed",
              "zkir",
              "*",
            ),
          ),
          // src: "src/contract-round-value/src/managed/counter/zkir/*",
          dest: "zkir",
        },
        {
          src: normalizePath(
            path.resolve(
              midnightContractsDir,
              "contract-werewolf.undeployed.json",
            ),
          ),
          dest: "contract_address",
        },

        {
          src: normalizePath(
            path.resolve(
              midnightContractsDir,
              "contract-werewolf",
              "src",
              "managed",
              "keys",
              "*",
            ),
          ),
          // src: "src/contract-round-value/src/managed/counter/keys/*",
          dest: "keys",
        },
        {
          src: normalizePath(
            path.resolve(
              midnightContractsDir,
              "contract-werewolf",
              "src",
              "managed",
              "zkir",
              "*",
            ),
          ),
          // src: "src/contract-round-value/src/managed/counter/zkir/*",
          dest: "zkir",
        },
        {
          src: normalizePath(
            path.resolve(
              midnightContractsDir,
              "contract-werewolf.undeployed.json",
            ),
          ),
          dest: "contract_address",
        },
      ],
    }),
  ],

  optimizeDeps: {
    exclude: [
      "@midnight-ntwrk/onchain-runtime-v2",
      "@midnight-ntwrk/onchain-runtime",
      "@midnight-ntwrk/midnight-js-node-zk-config-provider",
    ],
    include: [
      // "@midnight-ntwrk/midnight-js-network-id",
      "react/jsx-runtime",
      "@midnight-ntwrk/compact-runtime",
      "@midnight-ntwrk/midnight-js-contracts",
      "@scure/bip39",
    ],
    esbuildOptions: {
      target: "esnext",
    },
  },
});
