import type { Pool } from "pg";
import { runPreparedQuery } from "@paimaexample/db";
import {
  closeLobby,
  getAdminSignKey,
  getGameView,
  getLobby,
  getLobbyPlayers,
  getWerewolfRoundState,
  incrementLobbyPlayerCount,
  insertLobbyPlayer,
  updateRoundVoteCount,
  upsertLobby,
} from "@werewolf-game/database";
import type { IInsertLobbyPlayerResult } from "@werewolf-game/database";
import nacl from "tweetnacl";
import * as store from "../store.ts";

const CHAT_SERVER_URL = Deno.env.get("CHAT_SERVER_URL") ??
  "http://localhost:3001";
const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

function chatPost(path: string, body: unknown): Promise<void> {
  return fetch(`${CHAT_SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => {
    if (!res.ok) {
      console.warn(`[chat] POST ${path} returned HTTP ${res.status}`);
    }
  }).catch((err) => console.warn(`[chat] POST ${path} failed:`, err));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

// ── Handler types ──────────────────────────────────────────────────────────

export type PlayerBundle = {
  gameId: string;
  playerId: number;
  leafSecret: string;
  merklePath: { sibling: { field: string }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
};

// ── Handlers ───────────────────────────────────────────────────────────────

export async function createGameHandler(
  dbConn: Pool,
  gameId: number,
  maxPlayers: number,
  adminSignPublicKeyHex: string,
  playerBundles: PlayerBundle[],
) {
  if (maxPlayers < 5) {
    throw Object.assign(new Error("Minimum 5 players required."), {
      statusCode: 400,
    });
  }

  await runPreparedQuery(
    upsertLobby.run({
      game_id: gameId,
      max_players: maxPlayers,
      created_block: 0,
      admin_sign_public_key: adminSignPublicKeyHex,
    }, dbConn),
    "upsertLobby",
  );

  // Store bundles in memory — never written to DB so effectstream cannot expose them.
  store.storePendingBundles(gameId, playerBundles as store.PlayerBundle[]);

  // Cache the admin signing public key so votes_for_round can verify without a DB lookup.
  store.setAdminSignKey(gameId, adminSignPublicKeyHex);

  console.log(
    `[lobby] Game ${gameId} created with ${playerBundles.length} bundles (in-memory only)`,
  );

  return {
    gameId,
    state: "Open" as const,
  };
}

export async function joinGameHandler(
  dbConn: Pool,
  gameId: number,
  midnightAddressHash: string,
  nickname: string,
) {
  // Check if this player is already registered (either via a prior API call or
  // because the state machine STF processed the batcher transaction first and
  // called insertLobbyPlayer before this HTTP request arrived).
  const existingPlayers = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );
  const alreadyJoined = existingPlayers.some(
    (p) => p.midnight_address_hash === midnightAddressHash,
  );

  // Always (re-)invite to general chat — invitePlayer is idempotent on the
  // chat server (Set.add / Map.set), so sending it more than once is safe.
  await chatPost("/invite", { gameId, midnightAddressHash, nickname });

  if (alreadyJoined) {
    // Check if the bundle has already been delivered to this player
    const existing = store.getDeliveredBundle(gameId, midnightAddressHash);
    if (existing) {
      // Bundle already delivered — client must use /api/get_bundle with a
      // leafSecret-derived signature to re-retrieve it. This prevents any caller
      // without the leafSecret from fetching sensitive role/merkle data.
      if (existing.bundle.role === 1) {
        await chatPost("/invite", {
          gameId,
          midnightAddressHash,
          nickname,
          channel: "werewolf",
        });
      }
      console.log(
        `[lobby] Player ${midnightAddressHash} re-joined game ${gameId} — bundle requires signature.`,
      );
      return { success: false, requiresSignature: true };
    }

    // Player is in DB but no bundle delivered yet — this happens when the
    // STF processed the batcher transaction before this HTTP request arrived.
    // Skip DB insert/increment (already done by STF) and proceed to deliver bundle.
    console.log(
      `[lobby] Player ${midnightAddressHash} found in DB but bundle not delivered yet — first-time delivery (STF raced ahead).`,
    );
  } else {
    // First time joining via this API — insert the player and increment count.
    // (When the state machine fires later it will hit ON CONFLICT DO NOTHING.)
    const insertResult = await runPreparedQuery(
      insertLobbyPlayer.run({
        game_id: gameId,
        midnight_address_hash: midnightAddressHash,
        nickname,
        joined_block: 0,
      }, dbConn),
      "insertLobbyPlayer",
    ) as unknown as IInsertLobbyPlayerResult[];
    // Only increment player count if the insert actually happened (RETURNING game_id exists)
    // This prevents double-increment when the STF has already inserted the player.
    if (insertResult.length > 0) {
      await runPreparedQuery(
        incrementLobbyPlayerCount.run({ game_id: gameId }, dbConn),
        "incrementLobbyPlayerCount",
      );
    }
  }

  // Check that there are still bundles left (slots open).
  const remaining = store.countPendingBundles(gameId);
  if (remaining === 0) {
    throw Object.assign(
      new Error("Game not found or already started."),
      { statusCode: 409 },
    );
  }

  // Pop one bundle from the in-memory pool.
  const bundle = store.popPendingBundle(gameId) as PlayerBundle | undefined;
  if (!bundle) {
    throw Object.assign(new Error("Bundle pool unexpectedly empty."), {
      statusCode: 500,
    });
  }

  // Store delivered bundle in memory so it can be re-retrieved with signature.
  store.storeDeliveredBundle(
    gameId,
    midnightAddressHash,
    bundle as store.PlayerBundle,
  );

  // If the player is a werewolf, invite them to the werewolf-only channel.
  // Must be awaited so the allowlist is populated before this response reaches
  // the client — the frontend connects to the werewolf WebSocket immediately
  // after receiving the bundle, so fire-and-forget would cause NOT_ALLOWED.
  if (bundle.role === 1) {
    await chatPost("/invite", {
      gameId,
      midnightAddressHash,
      nickname,
      channel: "werewolf",
    });
  }

  let gameStarted = false;

  // remaining was the count before the pop, so after the pop there are remaining-1 left.
  if (remaining - 1 === 0) {
    // Last slot filled — start the game.
    await runPreparedQuery(
      closeLobby.run({ game_id: gameId }, dbConn),
      "closeLobby",
    );
    chatPost("/broadcast", {
      gameId,
      text: "GAME_STARTED: All players have joined. The game begins now.",
    });
    gameStarted = true;
    console.log(`[lobby] Game ${gameId} started — all slots filled.`);
  }

  return { success: true, bundle, gameStarted };
}

export async function getBundleHandler(
  gameId: number,
  playerHash: string,
  timestamp: number,
  signature: string,
): Promise<{ success: boolean; bundle?: PlayerBundle }> {
  // Validate timestamp freshness (guard against replay attacks).
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > MAX_TIMESTAMP_AGE_SECONDS) {
    throw Object.assign(
      new Error("Request timestamp too old or too far in the future."),
      { statusCode: 403 },
    );
  }

  const entry = store.getDeliveredBundle(gameId, playerHash);
  if (!entry) {
    throw Object.assign(
      new Error(
        "Bundle not found. Player may not have joined yet, or server was restarted.",
      ),
      { statusCode: 404 },
    );
  }

  // Verify signature: the player proves ownership of their leafSecret by signing
  // a canonical message with the Ed25519 key derived from it.
  const message = new TextEncoder().encode(
    `retrieve:${gameId}:${playerHash}:${timestamp}`,
  );
  const sigBytes = hexToBytes(signature);
  const isValid = nacl.sign.detached.verify(
    message,
    sigBytes,
    entry.sigPublicKey,
  );
  if (!isValid) {
    throw Object.assign(new Error("Invalid signature."), { statusCode: 403 });
  }

  return { success: true, bundle: entry.bundle as PlayerBundle };
}

export async function closeGameHandler(dbConn: Pool, gameId: number) {
  await runPreparedQuery(
    closeLobby.run({ game_id: gameId }, dbConn),
    "closeLobby",
  );
  return { success: true };
}

export async function getGameStateHandler(dbConn: Pool, gameId: number) {
  const lobbyRows = await runPreparedQuery(
    getLobby.run({ game_id: gameId }, dbConn),
    "getLobby",
  );
  if (lobbyRows.length === 0) {
    throw new Error(`Game ${gameId} not found`);
  }
  const lobby = lobbyRows[0];
  return {
    id: typeof lobby.game_id === "string"
      ? Number(lobby.game_id)
      : lobby.game_id,
    state: lobby.closed ? ("Closed" as const) : ("Open" as const),
    playerCount: typeof lobby.player_count === "string"
      ? Number(lobby.player_count)
      : lobby.player_count,
    maxPlayers: typeof lobby.max_players === "string"
      ? Number(lobby.max_players)
      : lobby.max_players,
  };
}

export async function getPlayersHandler(dbConn: Pool, gameId: number) {
  const players = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );
  return {
    gameId,
    players: players.map((p) => {
      // Enrich each DB row with the playerId from the in-memory delivered bundle.
      // Returns null after a server restart (the bundle pool is lost), but the
      // player can re-retrieve their bundle via /api/get_bundle.
      const entry = store.getDeliveredBundle(gameId, p.midnight_address_hash);
      return {
        midnightAddressHash: p.midnight_address_hash,
        nickname: p.nickname,
        playerId: entry?.bundle.playerId ?? undefined,
      };
    }),
  };
}

async function triggerMidnightVoteSubmission(
  gameId: number,
  round: number,
  phase: string,
): Promise<void> {
  const votes = store.getVotes(gameId, round, phase);

  console.log(
    `[votes] All ${votes.length} votes collected for game=${gameId} round=${round} phase=${phase}.` +
      ` The dApp (trusted node) will decrypt, submit to chain, and resolve the phase via its polling loop.`,
  );

  // Notify all players in chat that voting has closed.
  chatPost("/broadcast", {
    gameId,
    text:
      `All votes received for round ${round} (${phase}). Processing results…`,
  });
}

export async function submitVoteHandler(
  dbConn: Pool,
  gameId: number,
  round: number,
  phase: string,
  voterIndex: number,
  targetIndex: number,
  encryptedVoteHex: string,
  merklePathJson: string,
): Promise<{
  success: boolean;
  alreadyVoted?: boolean;
  allVotesIn?: boolean;
  voteCount?: number;
  aliveCount?: number;
}> {
  // Store vote in memory — returns false if this voter already submitted.
  const added = store.addVote(gameId, round, phase, {
    voterIndex,
    encryptedVoteHex,
    merklePathJson,
  });
  if (!added) {
    return { success: true, alreadyVoted: true };
  }

  const voteCount = store.countVotes(gameId, round, phase);

  const roundRows = await runPreparedQuery(
    getWerewolfRoundState.run({ game_id: gameId, round, phase }, dbConn),
    "getWerewolfRoundState",
  );
  const aliveCount = roundRows.length > 0
    ? Number((roundRows[0] as unknown as { alive_count: string }).alive_count)
    : null;

  // Sync vote count to round state so the timeout STF sees accurate numbers.
  if (aliveCount !== null) {
    await runPreparedQuery(
      updateRoundVoteCount.run({
        game_id: gameId,
        round,
        phase,
        votes_submitted: voteCount,
      }, dbConn),
      "updateRoundVoteCount",
    );
  }

  const allVotesIn = aliveCount !== null && voteCount >= aliveCount;

  if (allVotesIn) {
    void triggerMidnightVoteSubmission(gameId, round, phase).catch(
      (err) => console.error("[submitVote] Midnight submission failed:", err),
    );
  }

  console.log(
    `[votes] game=${gameId} round=${round} phase=${phase} voter=${voterIndex} target=${targetIndex} votes=${voteCount}/${
      aliveCount ?? "?"
    }`,
  );

  return { success: true, voteCount, aliveCount: aliveCount ?? 0, allVotesIn };
}

export async function getVoteStatusHandler(
  dbConn: Pool,
  gameId: number,
  round: number,
  phase: string,
): Promise<{ voteCount: number; aliveCount: number }> {
  const roundRows = await runPreparedQuery(
    getWerewolfRoundState.run({ game_id: gameId, round, phase }, dbConn),
    "getWerewolfRoundState",
  );
  return {
    voteCount: store.countVotes(gameId, round, phase),
    aliveCount: roundRows.length > 0
      ? Number((roundRows[0] as unknown as { alive_count: string }).alive_count)
      : 0,
  };
}

export async function getVotesForRoundHandler(
  dbConn: Pool,
  gameId: number,
  round: number,
  phase: string,
  timestamp: number,
  signature: string,
): Promise<
  {
    votes: {
      voterIndex: number;
      encryptedVoteHex: string;
      merklePathJson: string;
    }[];
  }
> {
  if (!["NIGHT", "DAY"].includes(phase)) {
    throw Object.assign(new Error("Invalid phase. Must be 'NIGHT' or 'DAY'."), {
      statusCode: 400,
    });
  }
  if (!Number.isInteger(round) || round < 1 || round > 100) {
    throw Object.assign(new Error("Invalid round."), { statusCode: 400 });
  }

  // Validate timestamp freshness (anti-replay).
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > MAX_TIMESTAMP_AGE_SECONDS) {
    throw Object.assign(
      new Error("Request timestamp too old or too far in the future."),
      { statusCode: 403 },
    );
  }

  // Load admin signing public key — check in-memory cache first, then DB.
  let adminSignKey = store.getAdminSignKey(gameId);
  if (!adminSignKey) {
    const rows = await runPreparedQuery(
      getAdminSignKey.run({ game_id: gameId }, dbConn),
      "getAdminSignKey",
    );
    const keyHex = (rows[0] as unknown as { admin_sign_public_key: string })
      .admin_sign_public_key;
    if (!keyHex) {
      throw Object.assign(
        new Error("Game not found or admin signing key not registered."),
        { statusCode: 403 },
      );
    }
    store.setAdminSignKey(gameId, keyHex);
    adminSignKey = store.getAdminSignKey(gameId)!;
  }

  // Verify Ed25519 signature over `${round}:${phase}:${timestamp}`.
  const message = new TextEncoder().encode(`${round}:${phase}:${timestamp}`);
  const sigBytes = hexToBytes(signature);
  const isValid = nacl.sign.detached.verify(message, sigBytes, adminSignKey);
  if (!isValid) {
    throw Object.assign(new Error("Invalid moderator signature."), {
      statusCode: 403,
    });
  }

  return {
    votes: store.getVotes(gameId, round, phase),
  };
}

export async function getGameViewHandler(dbConn: Pool, gameId: number) {
  const rows = await runPreparedQuery(
    getGameView.run({ game_id: gameId }, dbConn),
    "getGameView",
  );

  if (rows.length === 0) {
    throw new Error(`Game view for game ${gameId} not found`);
  }

  const row = rows[0];
  const aliveVector: boolean[] = JSON.parse(row.alive_vector);
  const werewolfIndicesRaw: number[] = JSON.parse(row.werewolf_indices);

  const players = aliveVector.map((alive, index) => ({
    index,
    alive,
  }));

  // Only expose werewolf indices if the game is finished (defense in depth)
  const werewolfIndices = row.finished ? werewolfIndicesRaw : [];

  return {
    gameId: typeof row.game_id === "string" ? Number(row.game_id) : row.game_id,
    phase: row.phase,
    round: row.round,
    playerCount: row.player_count,
    aliveCount: row.alive_count,
    werewolfCount: row.werewolf_count,
    villagerCount: row.villager_count,
    players,
    finished: row.finished,
    werewolfIndices,
    updatedBlock: typeof row.updated_block === "string"
      ? Number(row.updated_block)
      : row.updated_block,
  };
}
