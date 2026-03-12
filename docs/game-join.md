# Game Join & Rejoin Flow

## Overview

Joining a werewolf game involves two cryptographic identities working together:

- **EVM wallet** (MetaMask) — the player's persistent Ethereum identity, used to sign batcher transactions and to derive the game keypair.
- **Ed25519 game keypair** — a per-game signing keypair used to authenticate bundle requests. Derived deterministically from the EVM wallet; never stored.

---

## First Join

### 1. Connect wallets

The player clicks **Connect Browser Wallets** on the lobby screen.

1. MetaMask connection requested → EVM address obtained.
2. Lace (Midnight wallet) connection requested → shielded address obtained.
3. Both wallet addresses are shown in the UI.
4. **In parallel:**
   - `autoDiscoverLobby()` — polls `/api/open_lobby` every 3 s until an open game is found and auto-fills the game phrase input.
   - `loadActiveGames()` — scans `localStorage` for any persisted sessions from previous games and renders "Your Active Games" tiles (see [Rejoin](#rejoin)).

### 2. Find game

The player enters a **game ID or 4-word phrase** and clicks **Find Game** (or the auto-discovery fills it in).

- `/api/contracts` (via `getGameState`) is queried to retrieve game state from the Midnight ledger.
- If the game is **Open** and has capacity, the nickname input and **Join Game** button are revealed.

### 3. Join game

The player enters a nickname and clicks **Join Game**. Two MetaMask prompts follow in sequence:

#### Prompt 1 — Keypair derivation

MetaMask signs the fixed message:

```
werewolf:{gameId}
```

The resulting 65-byte ECDSA signature is SHA-256 hashed to produce a 32-byte seed, which is fed into `nacl.sign.keyPair.fromSeed(seed)`. This yields the player's **deterministic Ed25519 keypair** for this game.

Because EVM ECDSA uses RFC 6979 deterministic `k`-generation, the same MetaMask account signing the same message always produces the same signature — making the Ed25519 keypair fully reproducible on any device that holds the EVM private key.

#### Prompt 2 — Batcher transaction

MetaMask signs the batcher join message:

```
join_game | {gameId} | {publicKeyHex} | {nickname}
```

The batcher submits this to the Paima chain on the player's behalf (no gas paid by the player). The Paima STM processes the `join_game` transition, writing `(game_id, public_key_hex, nickname, joined_block)` to `werewolf_lobby_players`.

### 4. Wait for lobby to close

After joining, the UI polls `/api/lobby_status/{gameId}` every 4 s, updating the player count display.

When the lobby is closed and the server admin generates bundles, `bundles_ready` becomes `true`.

### 5. Fetch bundle

The client authenticates to `/api/get_bundle` using an **Ed25519 detached signature**:

```
message  = "werewolf:{gameId}:{unixTimestamp}"
signature = nacl.sign.detached(message, keypair.secretKey)
```

The server verifies the signature against the stored `public_key_hex` and returns the player's **bundle** — a JSON object containing:

| Field | Description |
|---|---|
| `playerId` | Player index in the game (0-based) |
| `role` | Role number (0 = villager, 1 = werewolf, 2 = doctor, 3 = seer) |
| `leafSecret` | Private Merkle leaf secret for on-chain vote commitments |
| `merklePath` | Merkle path siblings for zero-knowledge proofs |
| `adminVotePublicKeyHex` | Admin public key for vote resolution |

### 6. Session persisted

Immediately before the lobby screen is hidden, a **session** is saved to `localStorage`:

```
key:   "werewolf:session:{gameId}"
value: { gameId, publicKeyHex, nickname, evmAddress, bundle }
```

The Ed25519 **secret key is never stored**. It is re-derived on demand from the EVM wallet.

### 7. Game boots

`onJoined()` fires → `bootGame()` runs:

- Game view and player list are fetched from the backend.
- 3D scene, HUD, chat, and pollers are initialised.
- The player's role is applied to their player entity and announced in chat.
- `GameViewPoller` and `VoteStatusPoller` start, keeping the UI in sync with the ledger.

---

## Rejoin (after page refresh)

When the player refreshes or returns to the page and reconnects their wallets, `loadActiveGames()` runs automatically. If any sessions are found in `localStorage`, rejoin tiles appear above the find-game section.

### Tile display

For each session in `localStorage`, `/api/lobby_status/{gameId}` is fetched in parallel. Sessions that return a 404 or network error have their `localStorage` entry cleared (the game no longer exists). Remaining sessions are shown as tiles with a live status badge:

| Badge | Meaning |
|---|---|
| 🟢 Open | Lobby still accepting players |
| ⏳ Waiting for bundles | Lobby closed, bundles being generated |
| 🎮 In Progress | Game is running |

### Clicking Rejoin

The player clicks **Rejoin** on a tile. One MetaMask prompt follows:

#### Prompt — Keypair re-derivation

MetaMask signs `"werewolf:{gameId}"` again → same derivation as on first join → identical Ed25519 keypair recovered.

Then one of three paths is taken depending on what is cached locally and what the server reports:

| Situation | Action |
|---|---|
| Bundle cached in `localStorage` | Restore bundle directly; call `onJoined` immediately — no network request for the bundle |
| Bundle not cached but `bundlesReady = true` | Re-fetch bundle from `/api/get_bundle` using derived keypair; call `onJoined` |
| `bundlesReady = false` | Resume `pollForBundles` to wait for server to generate the bundle |

After the bundle is resolved, `onJoined` fires and the game boots exactly as in a first join (step 7 above).

### Cross-browser rejoin

Because the keypair is derived purely from the EVM wallet signature, a player who knows their game phrase can rejoin from **any browser** that has the same MetaMask account:

1. Enter the game phrase in the Find Game input.
2. Click **Rejoin** (shown when the game is closed and bundles are ready).
3. MetaMask signs `"werewolf:{gameId}"` → keypair derived → bundle fetched from server.

No `localStorage` entry is required for this path — the bundle is always re-fetchable as long as the server is running.

### Session cleanup

When `gameState.finished` fires (game over), `clearSession(gameId)` removes the `localStorage` entry. On the next page load, the completed game tile will not appear.

---

## Sequence Diagram

```
Player                    LobbyScreen              Batcher/Chain           Backend
  |                           |                          |                     |
  |── Connect wallets ────────>|                          |                     |
  |<─ EVM + Midnight ─────────|                          |                     |
  |                           |── /api/open_lobby ───────────────────────────>|
  |                           |<─ { gameId } ─────────────────────────────────|
  |                           |── /api/contracts ────────────────────────────>|
  |<─ Game info shown ────────|                          |                     |
  |── Enter nickname, Join ──>|                          |                     |
  |                           |                          |                     |
  | [MetaMask prompt 1]       |                          |                     |
  |── signMessage("werewolf:42") ──────────────────────>|                     |
  |<─ ECDSA sig ──────────────────────────────────────── |                     |
  |── SHA-256(sig) → Ed25519 seed → keypair ──────────>|                     |
  |                           |                          |                     |
  | [MetaMask prompt 2]       |                          |                     |
  |── signMessage(batcherMsg) ─────────────────────────>|                     |
  |<─ batcher sig ─────────────────────────────────────  |                     |
  |                           |── submit join_game tx ──>|                     |
  |                           |                          |── STM join_game ──>|
  |                           |                          |                     |── INSERT lobby_player
  |                           |── poll /lobby_status ───────────────────────>|
  |                           |<─ { bundlesReady: true } ──────────────────── |
  |                           |── GET /api/get_bundle ──────────────────────>|
  |                           |   (Ed25519 sig auth)     |                     |── verify sig
  |                           |<─ { bundle } ─────────────────────────────────|
  |                           |── saveSession(localStorage) ─────────────────>|
  |<─ Game screen ────────────|                          |                     |
```

---

## Key Files

| File | Role |
|---|---|
| `packages/frontend-ui/src/screens/LobbyScreen.ts` | Join / rejoin UI flows, `deriveGameKeypair()` |
| `packages/frontend-ui/src/services/sessionStore.ts` | `saveSession`, `loadSession`, `clearSession`, `getAllSessions` |
| `packages/frontend-ui/src/services/lobbyApi.ts` | `fetchBundle`, `fetchLobbyStatus`, `fetchPlayerGames` |
| `packages/frontend-ui/src/services/batcherService.ts` | Submits `join_game` via the Paima batcher |
| `packages/frontend-ui/src/main.ts` | `onJoined` callback — saves session, boots game |
| `packages/client/node/src/state-machine.ts` | STM `join_game` transition — writes player to DB |
| `packages/client/node/src/lobby-closer.ts` | Generates bundles when lobby closes |
| `packages/client/node/src/api/werewolfLobby.ts` | `GET /api/get_bundle` handler |
