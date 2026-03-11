import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const managedDir = resolve(
  __dirname,
  '../shared/contracts/midnight/contract-werewolf/src/managed',
)

/**
 * Serves compiled ZK contract artifacts (keys + zkir) from the shared managed
 * directory under /keys/* and /zkir/* — matching the layout expected by
 * FetchZkConfigProvider (fetches `${origin}/keys/${circuitId}.verifier`, etc.).
 */
function serveContractArtifacts() {
  return {
    name: 'serve-contract-artifacts',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url: string = req.url ?? ''
        let filePath: string | null = null

        if (url.startsWith('/keys/')) {
          filePath = resolve(managedDir, 'keys', url.slice('/keys/'.length))
        } else if (url.startsWith('/zkir/')) {
          filePath = resolve(managedDir, 'zkir', url.slice('/zkir/'.length))
        }

        if (filePath && fs.existsSync(filePath)) {
          res.setHeader('Content-Type', 'application/octet-stream')
          fs.createReadStream(filePath).pipe(res)
        } else {
          next()
        }
      })
    },
  }
}

/**
 * Custom Rollup resolver for vite-plugin-node-polyfills shims.
 *
 * When a transitive Midnight SDK dependency (e.g. wallet-sdk-address-format)
 * lives inside the Deno workspace cache (.deno/), the polyfill plugin correctly
 * detects Buffer usage and injects:
 *   import Buffer from "vite-plugin-node-polyfills/shims/buffer"
 *
 * Rollup tries to resolve that import relative to the symlink target path
 * which is outside packages/frontend-ui/node_modules/, so it can't find the
 * shim. This plugin always resolves the shim to its absolute local path.
 */
function resolvePolyfillShims() {
  const shimDir = resolve(__dirname, 'node_modules/vite-plugin-node-polyfills/shims')
  return {
    name: 'resolve-polyfill-shims',
    resolveId(id: string) {
      if (id.startsWith('vite-plugin-node-polyfills/shims/')) {
        const shimName = id.slice('vite-plugin-node-polyfills/shims/'.length)
        return { id: resolve(shimDir, shimName, 'dist/index.js') }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    // Required: Midnight SDK packages contain WASM modules
    wasm(),
    // Serve compiled ZK keys and zkir files from the shared managed directory
    serveContractArtifacts(),
    // Required: Midnight SDK transitive deps (leveldb, etc.) reference Node built-ins
    nodePolyfills({
      // Only polyfill modules actually used; keeps bundle size reasonable
      include: ['buffer', 'crypto', 'events', 'path', 'stream', 'util'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],

  build: {
    // esnext is required for top-level await and WASM ESM integration
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      plugins: [
        // Resolve polyfill shim imports that come from Deno-workspace packages
        // living outside packages/frontend-ui/node_modules/
        resolvePolyfillShims(),
      ],
    },
  },

  resolve: {
    // Prevent multiple instances of Midnight runtime singletons (WASM state machines
    // throw if instantiated more than once per page load)
    dedupe: [
      '@midnight-ntwrk/onchain-runtime-v2',
      '@midnight-ntwrk/onchain-runtime',
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/midnight-js-contracts',
    ],
  },

  optimizeDeps: {
    // Exclude WASM packages from Vite's pre-bundling (esbuild can't handle WASM)
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v2',
      '@midnight-ntwrk/onchain-runtime',
      '@midnight-ntwrk/compact-runtime',
    ],
    // Force pre-bundle these CJS packages so esbuild converts them to ESM.
    // Without this, Vite serves them raw and `import X from 'cjs-pkg'` fails
    // with "does not provide an export named 'default'".
    include: [
      '@midnight-ntwrk/midnight-js-contracts',
      // Pure CJS modules transitively used by Midnight SDK and node polyfills
      'object-inspect', // used by assert/error polyfills
      'inherits',       // used by stream/readable-stream polyfills
      'debug',          // used by various Midnight SDK deps
      'ms',             // used by debug
      'readable-stream', // used by LevelDB + stream polyfill
      'string_decoder', // used by readable-stream
      'util-deprecate', // used by readable-stream
      'core-util-is',   // used by readable-stream
    ],
    esbuildOptions: {
      target: 'esnext',
    },
  },

  server: {
    port: 5173,
  },
})
