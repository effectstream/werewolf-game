import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const managedDir = resolve(
  __dirname,
  '../shared/contracts/midnight/contract-werewolf/src/managed',
)
const publicDir = resolve(__dirname, 'public')
const cryptoShimPath = resolve(__dirname, 'src/shims/crypto.ts')
const levelShimPath = resolve(__dirname, 'src/shims/level.ts')

const threadedWasmHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/**
 * Serves compiled ZK contract artifacts (keys + zkir) from the shared managed
 * directory under /keys/* and /zkir/* — matching the layout expected by
 * FetchZkConfigProvider (fetches `${origin}/keys/${circuitId}.verifier`, etc.).
 */
function artifactMiddleware(req: any, res: any, next: any) {
  // Strip query params — Vite adds ?v=timestamp for cache busting which
  // would make fs.existsSync fail if included in the file path.
  const url: string = (req.url ?? '').split('?')[0]
  let filePath: string | null = null
  let rootDir: string | null = null

  if (url.startsWith('/keys/')) {
    rootDir = resolve(managedDir, 'keys')
    filePath = resolve(rootDir, url.slice('/keys/'.length))
  } else if (url.startsWith('/zkir/')) {
    rootDir = resolve(managedDir, 'zkir')
    filePath = resolve(rootDir, url.slice('/zkir/'.length))
  } else if (url.startsWith('/midnight-prover/')) {
    rootDir = resolve(publicDir, 'midnight-prover')
    filePath = resolve(rootDir, url.slice('/midnight-prover/'.length))
  }

  if (!filePath || !rootDir) {
    next()
    return
  }

  const rel = relative(rootDir, filePath)
  if (rel.startsWith('..') || rel === '') {
    res.statusCode = 400
    res.end('Invalid ZK artifact path')
    return
  }

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/octet-stream')
    fs.createReadStream(filePath).pipe(res)
    return
  }

  // Do not fall through to the SPA. HTML (e.g. index.html) would be fetched as
  // binary keys/IR and can make @paima/midnight-wasm-prover panic with
  // "capacity overflow" while deserializing bogus lengths.
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(`ZK artifact not found: ${url}`)
}

function serveContractArtifacts() {
  return {
    name: 'serve-contract-artifacts',

    // Dev + preview: stream artifacts from the managed source directory.
    configureServer(server: any) {
      server.middlewares.use(artifactMiddleware)
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(artifactMiddleware)
    },

    // Production build: emit all ZK keys and bzkir files as static assets so
    // they land in dist/keys/* and dist/zkir/*.  Without this the WASM prover
    // worker can't fetch them at runtime and proof generation fails with 404s.
    generateBundle(this: any) {
      const keysDir = resolve(managedDir, 'keys')
      const zkirDir = resolve(managedDir, 'zkir')

      for (const file of fs.readdirSync(keysDir)) {
        const src = resolve(keysDir, file)
        if (fs.statSync(src).isFile()) {
          this.emitFile({
            type: 'asset',
            fileName: `keys/${file}`,
            source: fs.readFileSync(src),
          })
        }
      }

      for (const file of fs.readdirSync(zkirDir)) {
        if (!file.endsWith('.bzkir')) continue
        const src = resolve(zkirDir, file)
        this.emitFile({
          type: 'asset',
          fileName: `zkir/${file}`,
          source: fs.readFileSync(src),
        })
      }
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
  // Load .env files from the repo root so `vite build --mode preprod` picks up
  // .env.preprod (which lives at the workspace root, not inside packages/frontend-ui).
  envDir: resolve(__dirname, '../..'),

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

  worker: {
    format: 'es',
  },

  resolve: {
    alias: {
      crypto: cryptoShimPath,
      'node:crypto': cryptoShimPath,
      level: levelShimPath,
    },
    // Prevent multiple instances of Midnight runtime singletons (WASM state machines
    // throw if instantiated more than once per page load)
    dedupe: [
      '@midnight-ntwrk/compact-js',
      '@midnight-ntwrk/ledger-v7',
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/onchain-runtime',
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/midnight-js-contracts',
    ],
  },

  optimizeDeps: {
    // Exclude WASM packages from Vite's pre-bundling (esbuild can't handle WASM)
    exclude: [
      '@paima/midnight-wasm-prover',
      '@midnight-ntwrk/ledger-v7',
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/midnight-js-level-private-state-provider',
      '@midnight-ntwrk/onchain-runtime-v3',
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
    headers: threadedWasmHeaders,
    port: Number(process.env.VITE_FRONTEND_PORT) || 5173,
  },

  preview: {
    headers: threadedWasmHeaders,
  },
})
