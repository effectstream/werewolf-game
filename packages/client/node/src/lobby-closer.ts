/**
 * Orchestrates the post-lobby-close workflow:
 *
 * 1. Generate bundles (roles, merkle trees, secrets)
 * 2. Store bundles in memory keyed by player public key
 * 3. Create the Midnight game via delegated balancing
 * 4. Mark bundles as ready in the DB
 * 5. Schedule the next auto-lobby creation
 *
 * Called as fire-and-forget from STFs (join_game when full, werewolfLobbyTimeout).
 */

import { generateBundles } from "../../../shared/utils/bundle-generator.ts";
import Prando from "prando";

// Deno's ESM resolution for the 'prando' NPM package sometimes treats it as a module
// rather than a class. This hack ensures we get the constructable class at runtime.
const PrandoClass = (Prando as any).default || Prando;
import {
  getEncryptedGameSeed,
  getLobbyPlayers,
  markBundlesReady,
  setAdminSignKeyUpdate,
  updateLobbyPlayerTrackingFields,
  upsertGameView,
} from "@werewolf-game/database";
import { runPreparedQuery } from "@effectstream/db";
import * as store from "./store.ts";
import { createMidnightGame } from "./midnight-game-creator.ts";
import { getDbPool } from "./db-pool.ts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  decryptGameSeed,
  deriveAdminWalletSeed,
  encryptedSeedToHex,
  encryptGameSeed,
  hexToEncryptedSeed,
} from "../../../shared/utils/game-key-crypto.ts";

const CHAT_SERVER_URL = process.env["CHAT_SERVER_URL"] ??
  "http://localhost:3001";
const BATCHER_URL = process.env["BATCHER_URL"] ?? "http://localhost:3334";

// Secret used to encrypt/decrypt the per-game seed stored on-chain and in DB.
// Any node sharing this value can recover the game seed after a restart.
// Falls back to an insecure default so local dev works without config.
const WEREWOLF_KEY_SECRET = process.env["WEREWOLF_KEY_SECRET"] ??
  (() => {
    console.warn(
      "[lobby-closer] WEREWOLF_KEY_SECRET not set — using insecure default. " +
        "Set this env var in production.",
    );
    return "werewolf-insecure-default-DO-NOT-USE-IN-PRODUCTION";
  })();

// Server-side EVM account used to sign autoCreateLobby batcher inputs.
// Set SYSTEM_PRIVATE_KEY env var to a dedicated key in production.
// Falls back to a random ephemeral key — the STF doesn't validate who sent autoCreateLobby.
const _systemAccount = privateKeyToAccount(
  (process.env["SYSTEM_PRIVATE_KEY"] as `0x${string}` | undefined) ??
    generatePrivateKey(),
);

// Security-namespace prefix the node's L2 primitive (and the batcher adapter)
// verify batched signatures against. MUST match setSecurityNamespace(...) in
// packages/shared/data-types/src/config*.ts and adapter-paimaL2.ts's
// SECURITY_NAMESPACE. Omitting it (the old "") made autoCreateLobby posts fail
// verification, breaking the lobby auto-create chain.
const SECURITY_NAMESPACE = "evm-midnight-node";

// --- Single-flight lobby creation guard -------------------------------------
//
// Lobby creation is asynchronous: scheduleNextLobby() posts to the batcher, the
// batcher includes the input on-chain, and only then does the autoCreateLobby
// STF insert the lobby into the DB — a window of several blocks. During that
// window a DB "open lobby" check still sees zero lobbies, so two lobbies
// closing near-simultaneously would each schedule a replacement, perpetuating a
// multi-lobby state.
//
// This in-memory flag (the node is a single process) guarantees at most ONE
// creation is pending at a time. It is set when we successfully post to the
// batcher and cleared by onLobbyCreated() (called from the autoCreateLobby STF
// once the lobby lands). A staleness safety-net clears it if a post succeeded
// but the STF never fired (e.g. input dropped) so we don't deadlock.
let lobbyCreationInFlightSince: number | null = null;
const LOBBY_CREATION_STALE_MS = 10 * 60 * 1000; // 10 min — well beyond normal landing time

// Periodic backstop: if no open lobby exists and nothing is in-flight, create
// one. Covers stuck guards, lobbies closed without scheduling, and the
// "create one on node start" requirement.
const LOBBY_RECONCILE_INTERVAL_MS = 25 * 60 * 1000; // 25 min

function isLobbyCreationInFlight(): boolean {
  if (lobbyCreationInFlightSince === null) return false;
  if (Date.now() - lobbyCreationInFlightSince > LOBBY_CREATION_STALE_MS) {
    console.warn(
      "[lobby-closer] Lobby-creation guard went stale — clearing (STF never landed?)",
    );
    lobbyCreationInFlightSince = null;
    return false;
  }
  return true;
}

/**
 * Called from the autoCreateLobby STF (state-machine.ts) once a new lobby has
 * actually been inserted into the DB. Releases the single-flight guard so the
 * next close/reconciler tick may schedule another creation.
 */
export function onLobbyCreated(): void {
  lobbyCreationInFlightSince = null;
}

/** Count currently-open (closed = FALSE) lobbies. Returns -1 on error. */
async function countOpenLobbies(): Promise<number> {
  const dbConn = getDbPool();
  const res = await dbConn.query(
    "SELECT COUNT(*) AS cnt FROM werewolf_lobby WHERE closed = FALSE",
  );
  return parseInt(res.rows[0]?.cnt ?? "0", 10);
}

/**
 * Reconstruct the message the paimaL2 batcher adapter + node L2 primitive verify.
 * Mirrors adapter-paimaL2.ts: namespace + timestamp + address + input (target is
 * NOT serialized on-chain, so it is re-verified as undefined → omitted).
 * timestamp must be milliseconds as a string (Date.now().toString()).
 */
function _batcherMessage(
  timestamp: string,
  address: string,
  input: string,
): string {
  return (SECURITY_NAMESPACE + timestamp + address + input)
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLocaleLowerCase();
}

function chatPost(path: string, body: unknown): void {
  void fetch(`${CHAT_SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => console.warn(`[chat] POST ${path} failed:`, err));
}

/**
 * Handle a lobby that has just been closed.
 *
 * @param gameId - The game that just closed.
 * @param options.cancelled - If true, the lobby was cancelled (not enough players).
 *                            Only creates the next lobby, skips bundle generation.
 */
export async function handleLobbyClosed(
  gameId: number,
  options?: { cancelled?: boolean },
): Promise<void> {
  const dbConn = getDbPool();

  console.log(`[lobby-closer] Starting bundle generation for game=${gameId}`);

  // 1. Decrypt the game seed stored on-chain and in DB.
  let gameSeed: Uint8Array | undefined;
  try {
    const seedRows = await runPreparedQuery(
      getEncryptedGameSeed.run({ game_id: gameId }, dbConn),
      "getEncryptedGameSeed",
    );
    const encHex = seedRows[0]?.encrypted_game_seed;
    if (encHex) {
      const blob = hexToEncryptedSeed(encHex);
      gameSeed = await decryptGameSeed(blob, WEREWOLF_KEY_SECRET);
      console.log(`[lobby-closer] game=${gameId} game seed decrypted from DB`);
    } else {
      console.warn(
        `[lobby-closer] game=${gameId} no encrypted_game_seed in DB — game seed unavailable`,
      );
    }
  } catch (err) {
    console.error(
      `[lobby-closer] game=${gameId} failed to decrypt game seed:`,
      err,
    );
  }

  if (options?.cancelled) {
    console.log(
      `[lobby-closer] game=${gameId} cancelled — skipping bundle generation, scheduling next lobby`,
    );
    await scheduleNextLobby(gameSeed);
    return;
  }

  // 2. Get player public keys in join order.
  const players = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );

  if (players.length < 2) {
    console.error(
      `[lobby-closer] game=${gameId} has ${players.length} players — cannot generate bundles`,
    );
    await scheduleNextLobby(gameSeed);
    return;
  }

  const playerCount = players.length;
  // Werewolf count: ~1/3 of players, minimum 1
  const werewolfCount = Math.max(1, Math.floor(playerCount / 3)); // 1 per 3 players (5→1, 6→2, 7→2, 9→3)

  // 3. Generate bundles.
  const result = generateBundles(
    BigInt(gameId),
    playerCount,
    werewolfCount,
    gameSeed,
  );

  console.log(
    `[lobby-closer] game=${gameId} generated ${result.playerBundles.length} bundles` +
      ` (${werewolfCount} werewolves, ${
        playerCount - werewolfCount
      } villagers)`,
  );

  // 4. Store bundles in memory keyed by (gameId, publicKeyHex).
  //    Deterministic assignment: join index 0 → bundle 0, etc.
  const bundleMap = new Map<string, store.PlayerBundle>();
  for (let i = 0; i < players.length; i++) {
    bundleMap.set(
      players[i].public_key_hex,
      result.playerBundles[i] as store.PlayerBundle,
    );
  }
  store.storeBundlesByPublicKey(gameId, bundleMap);

  // 4b. Persist player_idx and role to DB for leaderboard tracking.
  for (let i = 0; i < players.length; i++) {
    const bundle = bundleMap.get(players[i].public_key_hex);
    await runPreparedQuery(
      updateLobbyPlayerTrackingFields.run({
        game_id: gameId,
        public_key_hex: players[i].public_key_hex,
        player_idx: i,
        role: bundle?.role ?? 0,
      }, dbConn),
      "updateLobbyPlayerTrackingFields",
    );
  }

  // 4c. Invite players to chat channels now that roles are known.
  //     Re-inviting to general is idempotent and handles the case where the
  //     chat server restarted after players joined (rooms are in-memory only).
  //     Werewolves are invited to the werewolf channel for the first time here.
  for (let i = 0; i < players.length; i++) {
    const playerKey = players[i].public_key_hex;
    const nickname = (players[i].nickname as string | undefined) ?? `Player ${i}`;
    const bundle = bundleMap.get(playerKey);
    chatPost("/invite", { gameId, publicKeyHex: playerKey, nickname });
    if (bundle?.role === 1) {
      chatPost("/invite", {
        gameId,
        publicKeyHex: playerKey,
        nickname,
        channel: "werewolf",
      });
    }
  }

  // Admin-UI observer — invite fixed hashes so the admin dashboard can connect
  // to both channels without being a game participant.
  chatPost("/invite", {
    gameId,
    publicKeyHex: "admin-observer-general",
    nickname: "Admin",
  });
  chatPost("/invite", {
    gameId,
    publicKeyHex: "admin-observer-werewolf",
    nickname: "Admin",
    channel: "werewolf",
  });

  // 5. Store game secrets (including the decrypted game seed for future key derivation).
  store.storeGameSecrets(gameId, {
    masterSecret: result.masterSecret,
    adminSecret: result.adminSecret,
    adminVoteKeypair: result.adminVoteKeypair,
    adminSignKeypair: result.adminSignKeypair,
    gameSeed,
  });

  // 6. Store Merkle root (needed by resolveNightPhase automation).
  store.storeMerkleRoot(gameId, result.merkleRoot);

  // 7. Store admin signing key in DB + memory cache.
  store.setAdminSignKey(gameId, result.adminSignPublicKeyHex);
  await runPreparedQuery(
    setAdminSignKeyUpdate.run({
      game_id: gameId,
      admin_sign_public_key: result.adminSignPublicKeyHex,
    }, dbConn),
    "setAdminSignKeyUpdate",
  );

  // 8. Create the Midnight game via delegated balancing.
  // Derive a deterministic admin wallet seed from WEREWOLF_KEY_SECRET + gameId so
  // the wallet identity is always recoverable after a restart (used for delegated
  // balancing, not for on-chain authorization).
  const adminWalletSeed = await deriveAdminWalletSeed(WEREWOLF_KEY_SECRET, gameId);

  try {
    await createMidnightGame({
      gameId: BigInt(gameId),
      adminVotePublicKey: result.adminVoteKeypair.publicKey,
      adminSignPublicKey: result.adminSignKeypair.publicKey,
      adminSecretCommitment: result.adminSecretCommitment,
      masterSecretCommitment: result.masterSecretCommitment,
      actualCount: BigInt(playerCount),
      werewolfCount: BigInt(werewolfCount),
      roleCommitments: result.roleCommitments,
      merkleRoot: result.merkleRoot,
      batcherUrl: BATCHER_URL,
      seed: adminWalletSeed,
    });

    // Update stored secrets with the deterministic wallet seed.
    const currentSecrets = store.getGameSecrets(gameId);
    if (currentSecrets) {
      store.storeGameSecrets(gameId, {
        ...currentSecrets,
        adminWalletSeed,
      });
    }

    console.log(
      `[lobby-closer] game=${gameId} Midnight game creation submitted to batcher.`,
    );
  } catch (err) {
    console.error(
      `[lobby-closer] game=${gameId} Midnight game creation failed:`,
      err,
    );
    // Bundles are still stored in memory — the admin can manually create the
    // Midnight game via the debug flow, and the node will detect it via
    // midnightContractState STF.
  }

  // 8b. Pre-create the werewolf_game_view row so the frontend can read
  //     /api/game_view as soon as bundles become available. Without this,
  //     the row only exists once the Midnight createGame tx lands on-chain
  //     and fires the midnightContractState STF — leaving a window where
  //     bundles_ready=true but game_view 404s. Initial values mirror the
  //     contract's createGame (Phase.Night, round 1, all players alive);
  //     the STF upserts the authoritative values on the first on-chain update.
  const initialAliveVector = JSON.stringify(Array(playerCount).fill(true));
  await runPreparedQuery(
    upsertGameView.run({
      game_id: gameId,
      phase: "NIGHT",
      round: 1,
      player_count: playerCount,
      alive_count: playerCount,
      werewolf_count: werewolfCount,
      villager_count: playerCount - werewolfCount,
      alive_vector: initialAliveVector,
      finished: false,
      finished_at: null,
      werewolf_indices: "[]",
      updated_block: 0,
    }, dbConn),
    "upsertGameView",
  );
  store.setGameViewCache(gameId, {
    game_id: gameId,
    phase: "NIGHT",
    round: 1,
    player_count: playerCount,
    alive_count: playerCount,
    werewolf_count: werewolfCount,
    villager_count: playerCount - werewolfCount,
    alive_vector: initialAliveVector,
    finished: false,
    werewolf_indices: "[]",
    updated_block: 0,
  });

  // 9. Mark bundles ready in DB.
  await runPreparedQuery(
    markBundlesReady.run({ game_id: gameId }, dbConn),
    "markBundlesReady",
  );

  console.log(
    `[lobby-closer] game=${gameId} bundles ready — players can now request their bundles`,
  );

  // 10. Notify chat.
  chatPost("/broadcast", {
    gameId,
    text: "Bundles are ready! Request your bundle to start playing.",
  });

  // 11. Schedule next lobby.
  await scheduleNextLobby(gameSeed);
}

/**
 * Restore all in-memory game secrets after a server restart.
 *
 * Because generateBundles is fully deterministic when given the same gameSeed,
 * every secret (masterSecret, adminVoteKeypair, adminSignKeypair, player bundles,
 * merkleRoot) can be reproduced exactly. The adminWalletSeed is not derivable
 * from gameSeed so it is fetched from the DB where it was persisted at game creation.
 *
 * Returns true if recovery succeeded, false otherwise.
 */
export async function restoreGameSecrets(gameId: number): Promise<boolean> {
  if (store.getGameSecrets(gameId)) return true; // already in memory

  const dbConn = getDbPool();
  console.log(`[lobby-closer] Attempting secret recovery for game=${gameId}`);

  // 1. Get player list (preserves join order → bundle assignment).
  const players = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );
  if (players.length < 2) {
    console.error(
      `[lobby-closer] Recovery failed for game=${gameId}: only ${players.length} player(s) in DB`,
    );
    return false;
  }

  const playerCount = players.length;
  const werewolfCount = Math.max(1, Math.floor(playerCount / 3));

  // 2. Decrypt game seed.
  const seedRows = await runPreparedQuery(
    getEncryptedGameSeed.run({ game_id: gameId }, dbConn),
    "getEncryptedGameSeed",
  );
  const encHex = (seedRows[0] as any)?.encrypted_game_seed as string | null;
  if (!encHex) {
    console.error(
      `[lobby-closer] Recovery failed for game=${gameId}: no encrypted_game_seed in DB`,
    );
    return false;
  }

  let gameSeed: Uint8Array;
  try {
    const blob = hexToEncryptedSeed(encHex);
    gameSeed = await decryptGameSeed(blob, WEREWOLF_KEY_SECRET);
  } catch (err) {
    console.error(
      `[lobby-closer] Recovery failed for game=${gameId}: seed decryption failed`,
      err,
    );
    return false;
  }

  // 3. Derive adminWalletSeed deterministically — no DB fetch needed.
  const adminWalletSeed = await deriveAdminWalletSeed(WEREWOLF_KEY_SECRET, gameId);

  // 4. Regenerate all bundles deterministically from gameSeed.
  const result = generateBundles(BigInt(gameId), playerCount, werewolfCount, gameSeed);

  // 5. Restore bundles keyed by public key (same join-order assignment as original).
  const bundleMap = new Map<string, store.PlayerBundle>();
  for (let i = 0; i < players.length; i++) {
    bundleMap.set(
      (players[i] as any).public_key_hex as string,
      result.playerBundles[i] as store.PlayerBundle,
    );
  }
  store.storeBundlesByPublicKey(gameId, bundleMap);

  // 6. Restore game secrets.
  store.storeGameSecrets(gameId, {
    masterSecret: result.masterSecret,
    adminSecret: result.adminSecret,
    adminVoteKeypair: result.adminVoteKeypair,
    adminSignKeypair: result.adminSignKeypair,
    gameSeed,
    adminWalletSeed,
  });

  // 6b. Restore player_idx and role in DB (idempotent — needed for leaderboard recovery).
  for (let i = 0; i < players.length; i++) {
    const bundle = bundleMap.get((players[i] as any).public_key_hex as string);
    await runPreparedQuery(
      updateLobbyPlayerTrackingFields.run({
        game_id: gameId,
        public_key_hex: (players[i] as any).public_key_hex as string,
        player_idx: i,
        role: bundle?.role ?? 0,
      }, dbConn),
      "updateLobbyPlayerTrackingFields",
    );
  }

  // 7. Restore merkle root and admin sign key cache.
  store.storeMerkleRoot(gameId, result.merkleRoot);
  store.setAdminSignKey(gameId, result.adminSignPublicKeyHex);

  console.log(
    `[lobby-closer] game=${gameId} secrets restored (${playerCount} players, ${werewolfCount} werewolves)`,
  );
  return true;
}

/**
 * Schedule the next auto-lobby creation via the batcher.
 * The autoCreateLobby STF will fire and create the lobby + schedule its timeout.
 *
 * Self-guarded: at most one creation is pending per process. If a creation is
 * already in-flight, or an open lobby already exists, this is a no-op. This
 * makes every caller (handleLobbyClosed, startup bootstrap, the reconciler)
 * cooperative — they can all call this safely and only one lobby will result.
 */
export async function scheduleNextLobby(
  currentGameSeed?: Uint8Array,
): Promise<void> {
  // 1. Single-flight: another creation is pending on-chain. Don't stack.
  if (isLobbyCreationInFlight()) {
    console.log("[lobby-closer] Lobby creation already in-flight — skipping");
    return;
  }

  // 2. Don't create a duplicate if an open lobby already exists.
  try {
    const openCount = await countOpenLobbies();
    if (openCount > 0) {
      console.log(
        `[lobby-closer] ${openCount} open lobby(ies) already exist — skipping creation`,
      );
      return;
    }
  } catch (err) {
    // If the check itself fails, fall through and let the in-flight guard
    // (set below) be the main protection rather than blocking creation.
    console.warn("[lobby-closer] Open-lobby check failed:", err);
  }

  // Reserve the slot BEFORE posting so a concurrent close can't race in.
  lobbyCreationInFlightSince = Date.now();

  // Post to batcher to trigger the autoCreateLobby scheduled data.
  // This uses the same batcher /send-input mechanism for EVM inputs.
  try {
    // Generate a fresh 32-byte game seed and encrypt it before posting.
    // The encrypted blob (64 bytes = 128 hex chars) travels on-chain as calldata
    // and is stored in the DB by the autoCreateLobby STF.
    const gameSeedRaw = new Uint8Array(32);
    if (currentGameSeed) {
      const prando = new PrandoClass(
        Array.from(currentGameSeed, (b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );
      for (let i = 0; i < 32; i++) {
        gameSeedRaw[i] = prando.nextInt(0, 255);
      }
    } else {
      crypto.getRandomValues(gameSeedRaw);
    }
    const encryptedBlob = await encryptGameSeed(
      gameSeedRaw,
      WEREWOLF_KEY_SECRET,
    );
    const encryptedSeedHex = encryptedSeedToHex(encryptedBlob);

    const timestamp = Date.now().toString(); // ms string — matches paimaL2 adapter
    const address = _systemAccount.address;
    const target = "paimaL2";
    const input = JSON.stringify(["autoCreateLobby", encryptedSeedHex]);
    const message = _batcherMessage(timestamp, address, input);
    const signature = await _systemAccount.signMessage({ message });

    const response = await fetch(`${BATCHER_URL}/send-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          target,
          address,
          addressType: 0,
          input,
          timestamp,
          signature,
        },
        confirmationLevel: "no-wait",
      }),
    });

    if (response.ok) {
      console.log("[lobby-closer] Next lobby creation scheduled via batcher");
      // Guard stays set — cleared by onLobbyCreated() when the STF lands.
    } else {
      const text = await response.text();
      console.warn(
        `[lobby-closer] Failed to schedule next lobby: ${response.status} ${text}`,
      );
      lobbyCreationInFlightSince = null; // release so the reconciler can retry
    }
  } catch (err) {
    console.warn("[lobby-closer] Failed to schedule next lobby:", err);
    lobbyCreationInFlightSince = null; // release so the reconciler can retry
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reconciler: periodic guarantee that exactly one open lobby exists.
// Runs on node start (after a short grace period) and every 25 min thereafter.
// Safe to call alongside the startup bootstrap and handleLobbyClosed — they all
// route through the guarded scheduleNextLobby, so only one creation results.
// ---------------------------------------------------------------------------
export function startLobbyReconciler(): void {
  const reconcile = async () => {
    try {
      if (isLobbyCreationInFlight()) return;
      const openCount = await countOpenLobbies();
      if (openCount === 0) {
        console.log("[lobby-reconciler] No open lobby — creating one");
        await scheduleNextLobby();
      } else if (openCount > 1) {
        // Self-heal: excess lobbies will close on their own timeouts; once they
        // do, the guard ensures only one replacement is created, converging back
        // to a single lobby. Nothing to force-close here.
        console.log(
          `[lobby-reconciler] ${openCount} open lobbies — letting extras time out`,
        );
      }
    } catch (err) {
      console.warn("[lobby-reconciler] Check failed:", err);
    }
  };

  // First tick after a grace period so the startup bootstrap + migrations settle
  // before we second-guess lobby state.
  setTimeout(reconcile, 30_000);
  setInterval(reconcile, LOBBY_RECONCILE_INTERVAL_MS);
  console.log(
    `[lobby-reconciler] Started (interval=${LOBBY_RECONCILE_INTERVAL_MS / 1000}s, first tick in 30s)`,
  );
}
