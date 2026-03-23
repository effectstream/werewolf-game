# Publishing & Running on Preprod (Preview Network)

> **preprod = preview = testnet** for this project.
> The Midnight network identifier to use is always `"preprod"`.

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| Deno ≥ 1.40 | Runtime for all backend services |
| Node.js / npm | Frontend build (Vite) |
| `openssl` | Generating secrets |
| Funded Midnight wallet | Paying for on-chain transactions |
| Arbitrum Sepolia RPC | EVM parallel sync |

---

## Step 1 — Create `.env`

Copy the template and fill in all required values:

```bash
cp .env.preprod .env
```

### Required secrets

| Variable | How to generate |
|----------|----------------|
| `MIDNIGHT_WALLET_SEED` | Create a new Midnight wallet via Lace, export the seed (64-char hex). Or generate: `openssl rand -hex 32` |
| `MIDNIGHT_STORAGE_PASSWORD` | Any strong string ≥ 16 chars. Example: `openssl rand -base64 24` |
| `WEREWOLF_KEY_SECRET` | `openssl rand -hex 32` |
| `SYSTEM_PRIVATE_KEY` | `cast wallet new` (Foundry) or `openssl rand -hex 32`, prefix with `0x` |
| `ARBITRUM_SEPOLIA_RPC` | Get a free key from Alchemy/Infura for Arbitrum Sepolia |

> **Important**: `MIDNIGHT_WALLET_SEED` and `MIDNIGHT_STORAGE_PASSWORD` must
> stay consistent across restarts. Changing them makes existing private state
> unreadable.

### Midnight network URLs (auto-resolved)

When `MIDNIGHT_NETWORK_ID=preprod` the library automatically uses:

```
Indexer:      https://indexer.preprod.midnight.network/api/v3/graphql
Indexer WS:   wss://indexer.preprod.midnight.network/api/v3/graphql/ws
Node RPC:     https://rpc.preprod.midnight.network
Proof server: http://127.0.0.1:6300  (local — you must run it yourself)
```

You do **not** need to set `MIDNIGHT_INDEXER_HTTP`, `MIDNIGHT_INDEXER_WS`, or
`MIDNIGHT_NODE_HTTP` unless pointing to custom infrastructure.

---

## Step 2 — Fund the Server Wallet

The wallet derived from `MIDNIGHT_WALLET_SEED` needs tDUST and tNIGHT tokens.

1. Derive your wallet address by running the faucet script without a target address — it prints the address on startup:
   ```bash
   cd packages/shared/contracts/midnight
   MIDNIGHT_NETWORK_ID=preprod MIDNIGHT_WALLET_SEED=<seed> deno run -A faucet.ts
   ```
   Copy the `Unshielded address: mn_addr_preprod1...` from the output.

2. Fund the address from the [Midnight Faucet](https://faucet.preprod.midnight.network) (or equivalent preprod faucet).

3. Verify the balance appears before proceeding.

---

## Step 3 — Deploy the Midnight Contract

The Werewolf contract has 14 circuits — more than fits in a single block. The
incremental deployer handles this automatically.

```bash
cd packages/shared/contracts/midnight

# Set env vars (or source your .env file)
export $(grep -v '^#' ../../../../.env | xargs)

# Deploy (cleans previous state, then incrementally uploads all 14 VKs)
deno task midnight-contract:deploy
```

This will:
1. Deploy the contract shell (no verifier keys)
2. Upload each circuit's verifier key one by one (with retries)
3. Save progress to `deployment-state.json` (safe to resume if interrupted)
4. Write the contract address to `contract-werewolf.preprod.json`

**Resume after failure:** just re-run `deno task midnight-contract:deploy` — it
reads `deployment-state.json` and continues from where it stopped.

### Verify the deployment

```bash
deno task midnight-contract:verify
```

All 14 circuits must show as ✅. The output lists any missing circuits.

### Circuit deployment order

| Priority | Circuits |
|----------|---------|
| 1 — Core gameplay | `createGame`, `nightAction`, `resolveNightPhase`, `voteDay`, `resolveDayPhase` |
| 2 — Game management | `adminPunishPlayer`, `forceEndGame`, `getGameState`, `isPlayerAlive` |
| 3 — Data access | `getAdminKey`, `getGameAdminPublicKey`, `getEncryptedVotesForRound` |
| 4 — Verification | `revealPlayerRole`, `verifyFairness` |

---

## Step 4 — Start the Proof Server (local)

The proof server runs **locally** on port 6300 and is CPU-intensive. It is used
by both the batcher and the game node for circuit proving.

**When using `deno task preprod` (Step 5), the orchestrator starts the proof
server automatically** — you do not need to run this step manually.

If you need to run it standalone (e.g. in Docker or systemd), use:

```bash
cd packages/shared/contracts/midnight
export $(grep -v '^#' ../../../../.env | xargs)
deno task midnight-proof-server:start:preprod
```

This uses `LEDGER_NETWORK_ID=TestNet` and connects to the preprod Midnight node
via WebSocket (`SUBSTRATE_NODE_WS_URL`, defaulting to
`wss://rpc.preprod.midnight.network`).

Wait for it to be ready:
```bash
deno task midnight-proof-server:wait
```

---

## Step 5 — Start Backend Services

Run the preprod orchestrator. Both tasks automatically load `.env.preprod` via
Deno's `--env-file` flag before any module code executes — no manual `export`
needed:

```bash
cd packages/client/node
deno task preprod
```

Deno resolves the `--env-file=../../../.env.preprod` path relative to this
package's directory (`packages/client/node/`), so `.env.preprod` is always
read from the repo root regardless of where you invoke the task from.

**What it starts:**
| Service | Port | Notes |
|---------|------|-------|
| PGLite (DB) | internal | Local embedded Postgres |
| Collector | internal | Block sync and STF |
| Proof server | 6300 | Local ZK circuit prover (connects to preprod node over WS) |
| Batcher | 3334 | Off-chain circuit submission (waits for proof server) |
| Chat server | 3001 | Game event broadcast |

**What it does NOT start** (unlike local dev):
- ❌ Hardhat / local EVM node (we connect to Arbitrum Sepolia directly)
- ❌ Midnight node / indexer (we connect to preprod external services)
- ❌ Contract deployer (contract is already deployed — address read from JSON)
- ❌ Explorer UI (debug tool, not appropriate for public deployments)

### Bare node (no orchestrator)

If you manage services externally (e.g. via systemd/Docker) and only need the
game node process:

```bash
cd packages/client/node
deno task node:start:preprod
```

This runs `src/main.preprod.ts` directly with `--env-file=../../../.env.preprod`
already baked into the task — no manual export needed. No batcher or
chat-server are spawned, so you must start them separately.

### What the preprod node exposes

The `api.preprod.ts` router is intentionally restricted:

| Endpoint | Available |
|----------|-----------|
| `/api/create_game`, `/api/lobby_status`, `/api/get_bundle` … | ✅ |
| `/api/leaderboard`, `/api/game_view`, `/api/midnight_config` … | ✅ |
| `/api/faucet/nights` | ❌ removed (unsafe, dev-only) |
| `/debug/start_game` | ❌ removed (debug endpoint) |
| `/api/admin/*` (roles, votes, secrets) | ❌ removed (internal state) |

The node uses `config.testnet.ts` which reads `MIDNIGHT_NETWORK_ID`, fetches
the current chain tip automatically, and syncs from there.

---

## Step 6 — Build & Serve the Frontend

```bash
cd packages/frontend-ui

# Set Vite env vars
export VITE_MIDNIGHT_NETWORK_ID=preprod
export VITE_API_URL=https://game.yourhost.com       # adjust
export VITE_BATCHER_URL=https://batcher.yourhost.com  # adjust
export VITE_CHAT_SERVER_URL=wss://chat.yourhost.com  # adjust

# Build
npm run build

# Serve (static files in dist/)
npx serve dist
```

Players connect with Lace wallet set to the **Midnight Preprod** network.

---

## Step 7 — Transfer Dust to Players (optional faucet)

If players need tNIGHT tokens for gas, use the built-in faucet script:

```bash
cd packages/shared/contracts/midnight
export $(grep -v '^#' ../../../../.env | xargs)

MIDNIGHT_ADDRESS=mn_addr_preprod1<player_address> deno run -A faucet.ts
```

The faucet transfers 1,000,000,000 tNIGHT (1 NIGHT) per call from the server
wallet.

---

## Environment Variable Reference

### Required (no defaults)

| Variable | Used by | Description |
|----------|---------|-------------|
| `MIDNIGHT_WALLET_SEED` | batcher, deployer | 64-char hex seed for the server Midnight wallet |
| `MIDNIGHT_STORAGE_PASSWORD` | node, deployer | LevelDB private-state encryption password (≥16 chars) |
| `MIDNIGHT_NETWORK_ID` | everywhere | Set to `preprod` |
| `WEREWOLF_KEY_SECRET` | node | Symmetric key for per-game seed encryption |
| `SYSTEM_PRIVATE_KEY` | node | EVM private key for autoCreateLobby signing |
| `ARBITRUM_SEPOLIA_RPC` | node | Arbitrum Sepolia JSON-RPC URL |

### Frontend (Vite build-time)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MIDNIGHT_NETWORK_ID` | `"undeployed"` | Must be `"preprod"` |
| `VITE_API_URL` | `http://localhost:9999` | Backend game API |
| `VITE_BATCHER_URL` | `http://localhost:3334` | Batcher endpoint |
| `VITE_CHAT_SERVER_URL` | `ws://localhost:3001` | Chat server WebSocket |
| `VITE_MIDNIGHT_PARAMS_BASE_URL` | `window.location.origin` | ZK params base URL |

### Optional / defaults shown

| Variable | Default | Description |
|----------|---------|-------------|
| `MIDNIGHT_INDEXER_HTTP` | auto (preprod) | Override indexer HTTP URL (Paima middleware) |
| `MIDNIGHT_INDEXER_WS` | auto (preprod) | Override indexer WS URL (Paima middleware) |
| `MIDNIGHT_NODE_HTTP` | auto (preprod) | Override node RPC URL (Paima middleware) |
| `MIDNIGHT_INDEXER_URL` | `http://127.0.0.1:8088/...` | Indexer HTTP URL for **faucet.ts** (different var name!) |
| `MIDNIGHT_INDEXER_WS_URL` | `ws://127.0.0.1:8088/...` | Indexer WS URL for **faucet.ts** |
| `MIDNIGHT_NODE_URL` | `http://127.0.0.1:9944` | Node RPC URL for **faucet.ts** |
| `MIDNIGHT_PROOF_SERVER_URL` | `http://127.0.0.1:6300` | Proof server URL |
| `MIDNIGHT_DUST_RECEIVER_ADDRESS` | deployment wallet | Dust change receiver address override |
| `ENV` | `""` | Chat server mode — set to `"production"` for preprod |
| `MIDNIGHT_WALLET_MNEMONIC` | — | BIP-39 mnemonic (alternative to SEED) |
| `MIDNIGHT_WALLET_SYNC_TIMEOUT_MS` | `300000` | Wallet sync timeout (ms) |
| `MIDNIGHT_DUST_FEE_BLOCKS_MARGIN` | `5` | Dust fee blocks margin |
| `MIDNIGHT_DUST_FEE_OVERHEAD` | `300000000000000` | Dust fee overhead (bigint) |
| `BATCHER_URL` | `http://localhost:3334` | Batcher URL (backend side) |
| `CHAT_SERVER_URL` | `http://localhost:3001` | Chat server URL (backend side) |
| `BATCHER_PORT` | `3334` | Batcher HTTP port |
| `CHAT_SERVER_PORT` | `3001` | Chat server port |
| `EFFECTSTREAM_ENV` | — | Set to `"testnet"` for preprod |
| `EFFECTSTREAM_STDOUT` | — | Enable Effectstream stdout logging |
| `WEREWOLF_VOTE_TIMEOUT_BLOCKS` | `600` | Vote phase timeout (blocks) |
| `WEREWOLF_LOBBY_TIMEOUT_BLOCKS` | `1800` | Lobby timeout (blocks) |
| `WEREWOLF_LOBBY_MIN_PLAYERS` | `5` | Minimum players to start |
| `DISABLE_MIDNIGHT` | `false` | Disable Midnight adapter in batcher |
| `DISABLE_EVM` | `false` | Disable EVM adapter in batcher |
| `MIDNIGHT_DEPLOY_SKIP_INSERT_REMAINING_VKS` | `false` | Skip VK insertion in deploy |
| `MIDNIGHT_SKIP_WAIT_FOR_FUNDS` | `false` | Skip wallet fund check in deploy |

---

## Troubleshooting

**Wallet sync times out**
Increase `MIDNIGHT_WALLET_SYNC_TIMEOUT_MS` (e.g. `600000` for 10 min). The
preprod indexer may be slow on first sync.

**"Could not load verifier key" during deployment**
Run `deno task contract:compile` first, then re-deploy.

**Contract deploy stuck at circuit N/14**
Press Ctrl+C and re-run — it resumes automatically from the last checkpoint.

**Frontend can't connect to Lace on preprod**
Ensure `VITE_MIDNIGHT_NETWORK_ID=preprod` was set at build time (not runtime).
The value is baked into the JS bundle by Vite.

**Batcher "could not load contract address file"**
The contract must be deployed and `contract-werewolf.preprod.json` must exist
before starting the batcher. Run Step 3 first.
