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
import {
  getLobbyPlayers,
  markBundlesReady,
  setAdminSignKeyUpdate,
} from "@werewolf-game/database";
import { runPreparedQuery } from "@paimaexample/db";
import * as store from "./store.ts";
import { createMidnightGame } from "./midnight-game-creator.ts";
import { getDbPool } from "./db-pool.ts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const CHAT_SERVER_URL = Deno.env.get("CHAT_SERVER_URL") ??
  "http://localhost:3001";
const BATCHER_URL = Deno.env.get("BATCHER_URL") ?? "http://localhost:3334";

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

  if (options?.cancelled) {
    console.log(
      `[lobby-closer] game=${gameId} cancelled — skipping bundle generation, scheduling next lobby`,
    );
    await scheduleNextLobby();
    return;
  }

  console.log(`[lobby-closer] Starting bundle generation for game=${gameId}`);

  // 1. Get player public keys in join order.
  const players = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );

  if (players.length < 2) {
    console.error(
      `[lobby-closer] game=${gameId} has ${players.length} players — cannot generate bundles`,
    );
    await scheduleNextLobby();
    return;
  }

  const playerCount = players.length;
  // Werewolf count: ~1/3 of players, minimum 1
  const werewolfCount = Math.max(1, Math.floor(playerCount / 3));

  // 2. Generate bundles.
  const result = generateBundles(BigInt(gameId), playerCount, werewolfCount);

  console.log(
    `[lobby-closer] game=${gameId} generated ${result.playerBundles.length} bundles` +
      ` (${werewolfCount} werewolves, ${
        playerCount - werewolfCount
      } villagers)`,
  );

  // 3. Store bundles in memory keyed by (gameId, publicKeyHex).
  //    Deterministic assignment: join index 0 → bundle 0, etc.
  const bundleMap = new Map<string, store.PlayerBundle>();
  for (let i = 0; i < players.length; i++) {
    bundleMap.set(
      players[i].public_key_hex,
      result.playerBundles[i] as store.PlayerBundle,
    );
  }
  store.storeBundlesByPublicKey(gameId, bundleMap);

  // 4. Store game secrets.
  store.storeGameSecrets(gameId, {
    masterSecret: result.masterSecret,
    adminVoteKeypair: result.adminVoteKeypair,
    adminSignKeypair: result.adminSignKeypair,
  });

  // 5. Store admin signing key in DB + memory cache.
  store.setAdminSignKey(gameId, result.adminSignPublicKeyHex);
  await runPreparedQuery(
    setAdminSignKeyUpdate.run({
      game_id: gameId,
      admin_sign_public_key: result.adminSignPublicKeyHex,
    }, dbConn),
    "setAdminSignKeyUpdate",
  );

  // 6. Create the Midnight game via delegated balancing.
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
    });
    console.log(
      `[lobby-closer] game=${gameId} Midnight game creation submitted to batcher`,
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

  // 7. Mark bundles ready in DB.
  await runPreparedQuery(
    markBundlesReady.run({ game_id: gameId }, dbConn),
    "markBundlesReady",
  );

  console.log(
    `[lobby-closer] game=${gameId} bundles ready — players can now request their bundles`,
  );

  // 8. Notify chat.
  chatPost("/broadcast", {
    gameId,
    text: "Bundles are ready! Request your bundle to start playing.",
  });

  // 9. Schedule next lobby.
  await scheduleNextLobby();
}

/**
 * Schedule the next auto-lobby creation via the batcher.
 * The autoCreateLobby STF will fire and create the lobby + schedule its timeout.
 */
export async function scheduleNextLobby(): Promise<void> {
  // Post to batcher to trigger the autoCreateLobby scheduled data.
  // This uses the same batcher /send-input mechanism for EVM inputs.
  try {
    const timestamp = Date.now().toString(); // ms string — matches paimaL2 adapter
    const address = _systemAccount.address;
    const target = "paimaL2";
    const input = JSON.stringify(["autoCreateLobby"]);
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
