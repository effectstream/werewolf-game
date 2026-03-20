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
} from "@werewolf-game/database";
import { runPreparedQuery } from "@paimaexample/db";
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

const CHAT_SERVER_URL = Deno.env.get("CHAT_SERVER_URL") ??
  "http://localhost:3001";
const BATCHER_URL = Deno.env.get("BATCHER_URL") ?? "http://localhost:3334";

// Secret used to encrypt/decrypt the per-game seed stored on-chain and in DB.
// Any node sharing this value can recover the game seed after a restart.
// Falls back to an insecure default so local dev works without config.
const WEREWOLF_KEY_SECRET = Deno.env.get("WEREWOLF_KEY_SECRET") ??
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
  (Deno.env.get("SYSTEM_PRIVATE_KEY") as `0x${string}` | undefined) ??
    generatePrivateKey(),
);

/**
 * Reconstruct the message the paimaL2 batcher adapter verifies.
 * Mirrors adapter-paimaL2.ts: "" + timestamp + address + input (no target, no namespace).
 * timestamp must be milliseconds as a string (Date.now().toString()).
 */
function _batcherMessage(
  timestamp: string,
  address: string,
  input: string,
): string {
  return ("" + timestamp + address + input)
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
  // the wallet identity (std_ownPublicKey) is always recoverable after a restart
  // without any DB storage.
  const adminWalletSeed = await deriveAdminWalletSeed(WEREWOLF_KEY_SECRET, gameId);

  try {
    await createMidnightGame({
      gameId: BigInt(gameId),
      adminVotePublicKey: result.adminVoteKeypair.publicKey,
      adminSignPublicKey: result.adminSignKeypair.publicKey,
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
 */
export async function scheduleNextLobby(
  currentGameSeed?: Uint8Array,
): Promise<void> {
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
    } else {
      const text = await response.text();
      console.warn(
        `[lobby-closer] Failed to schedule next lobby: ${response.status} ${text}`,
      );
    }
  } catch (err) {
    console.warn("[lobby-closer] Failed to schedule next lobby:", err);
  }
}
