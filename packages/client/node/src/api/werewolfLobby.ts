import type { Pool } from "pg";
import { runPreparedQuery } from "@paimaexample/db";
import {
  closeLobby,
  getAdminSignKey,
  getAliveSnapshots,
  getGamesByEvmAddress,
  getGameView,
  getLeaderboard,
  getLobby,
  getLobbyPlayers,
  getWerewolfRoundState,
  markBundlesReady,
  updateRoundVoteCount,
  upsertLobby,
} from "@werewolf-game/database";
import type { IGetLeaderboardResult } from "@werewolf-game/database";
import nacl from "tweetnacl";
import * as store from "../store.ts";
import { decryptVotes, resolvePhaseFromVotes } from "../vote-resolver.ts";
import type { IGetGamesByEvmAddressResult } from "../../../database/src/sql/werewolf_lobby.queries.ts";

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

/**
 * Create a lobby in the database. Bundles are no longer passed in —
 * they are generated server-side after the lobby closes.
 */
export async function createGameHandler(
  dbConn: Pool,
  gameId: number,
  maxPlayers: number,
) {
  if (maxPlayers < 2) {
    throw Object.assign(new Error("Minimum 2 players required."), {
      statusCode: 400,
    });
  }

  await runPreparedQuery(
    upsertLobby.run({
      game_id: gameId,
      max_players: maxPlayers,
      created_block: 0,
      admin_sign_public_key: null,
    }, dbConn),
    "upsertLobby",
  );

  console.log(`[lobby] Game ${gameId} lobby created (max ${maxPlayers})`);

  return {
    gameId,
    state: "Open" as const,
  };
}

/**
 * Retrieve a bundle after the lobby has closed and bundles are ready.
 * The player proves identity by signing "werewolf:{gameId}:{timestamp}"
 * with the Ed25519 private key corresponding to their registered public key.
 */
export async function getBundleHandler(
  dbConn: Pool,
  gameId: number,
  publicKeyHex: string,
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

  // Check if bundles are ready.
  const lobbyRows = await runPreparedQuery(
    getLobby.run({ game_id: gameId }, dbConn),
    "getLobby",
  );
  if (lobbyRows.length === 0) {
    throw Object.assign(new Error("Game not found."), { statusCode: 404 });
  }
  if (!lobbyRows[0].bundles_ready) {
    throw Object.assign(
      new Error(
        "Bundles are not ready yet. Please wait for the lobby to close.",
      ),
      { statusCode: 425 },
    );
  }

  // Look up the player's public key for verification.
  let pubKeyBytes = store.getPlayerPublicKey(gameId, publicKeyHex);
  if (!pubKeyBytes) {
    // Try to reload from DB (e.g., after server restart).
    const players = await runPreparedQuery(
      getLobbyPlayers.run({ game_id: gameId }, dbConn),
      "getLobbyPlayers",
    );
    const found = players.find((p) => p.public_key_hex === publicKeyHex);
    if (!found) {
      throw Object.assign(
        new Error("Player not found in this lobby."),
        { statusCode: 404 },
      );
    }
    store.storePlayerPublicKey(gameId, publicKeyHex);
    pubKeyBytes = store.getPlayerPublicKey(gameId, publicKeyHex)!;
  }

  // Verify Ed25519 signature over "werewolf:{gameId}:{timestamp}".
  const message = new TextEncoder().encode(
    `werewolf:${gameId}:${timestamp}`,
  );
  const sigBytes = hexToBytes(signature);
  const isValid = nacl.sign.detached.verify(message, sigBytes, pubKeyBytes);
  if (!isValid) {
    throw Object.assign(new Error("Invalid signature."), { statusCode: 403 });
  }

  // Look up the bundle assigned to this public key.
  const bundle = store.getBundleByPublicKey(gameId, publicKeyHex);
  if (!bundle) {
    throw Object.assign(
      new Error(
        "Bundle not found. Server may have been restarted after bundle generation.",
      ),
      { statusCode: 404 },
    );
  }

  return { success: true, bundle: bundle as PlayerBundle };
}

export async function closeGameHandler(dbConn: Pool, gameId: number) {
  await runPreparedQuery(
    closeLobby.run({ game_id: gameId }, dbConn),
    "closeLobby",
  );
  return { success: true };
}

/**
 * Debug endpoint: force-closes a lobby and immediately starts bundle generation
 * and Midnight game creation, bypassing the batcher/contract flow.
 * Rejects if the lobby is not found, already closed, or has fewer than 2 players
 * (absolute minimum needed to generate bundles).
 */
export async function debugStartGameHandler(
  dbConn: Pool,
  gameId: number,
  handleLobbyClosed: (gameId: number) => Promise<void>,
) {
  const lobbyRows = await runPreparedQuery(
    getLobby.run({ game_id: gameId }, dbConn),
    "getLobby",
  );

  if (lobbyRows.length === 0) {
    throw Object.assign(new Error(`Lobby ${gameId} not found`), {
      statusCode: 404,
    });
  }

  const lobby = lobbyRows[0];

  if (lobby.closed) {
    throw Object.assign(new Error(`Lobby ${gameId} is already closed`), {
      statusCode: 409,
    });
  }

  const playerCount = Number(lobby.player_count);
  if (playerCount < 2) {
    throw Object.assign(
      new Error(
        `Lobby ${gameId} has only ${playerCount} player(s) — need at least 2`,
      ),
      { statusCode: 400 },
    );
  }

  await runPreparedQuery(
    closeLobby.run({ game_id: gameId }, dbConn),
    "closeLobby",
  );

  // Fire-and-forget: same flow as when lobby fills or times out with enough players
  void handleLobbyClosed(gameId).catch((err) =>
    console.error(`[debug] debugStartGame failed for game ${gameId}:`, err)
  );

  return { success: true, gameId, playerCount };
}

/**
 * Lobby status endpoint for frontend polling.
 */
export async function lobbyStatusHandler(dbConn: Pool, gameId: number) {
  const lobbyRows = await runPreparedQuery(
    getLobby.run({ game_id: gameId }, dbConn),
    "getLobby",
  );
  if (lobbyRows.length === 0) {
    throw Object.assign(new Error(`Game ${gameId} not found`), {
      statusCode: 404,
    });
  }
  const lobby = lobbyRows[0];

  let state: "open" | "closed" | "bundles_ready" = "open";
  if (lobby.bundles_ready) state = "bundles_ready";
  else if (lobby.closed) state = "closed";

  return {
    state,
    playerCount: Number(lobby.player_count),
    maxPlayers: Number(lobby.max_players),
    bundlesReady: lobby.bundles_ready,
    timeoutBlock: lobby.timeout_block ? Number(lobby.timeout_block) : undefined,
  };
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
    players: players.map((p, index) => {
      const bundle = store.getBundleByPublicKey(gameId, p.public_key_hex);
      return {
        publicKey: p.public_key_hex,
        nickname: p.nickname,
        playerId: bundle?.playerId ?? index,
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
    `[votes] All ${votes.length} votes collected for game=${gameId} round=${round} phase=${phase}. Auto-resolving…`,
  );

  chatPost("/broadcast", {
    gameId,
    text:
      `All votes received for round ${round} (${phase}). Processing results…`,
  });

  try {
    const result = await resolvePhaseFromVotes(gameId, round, phase);
    console.log(
      `[votes] Phase resolved: targetIdx=${result.targetIdx} hasElimination=${result.hasElimination} — ${result.info}`,
    );

    chatPost("/broadcast", {
      gameId,
      text: result.hasElimination
        ? `Phase resolved: Player ${result.targetIdx} was eliminated. ${result.info}`
        : `Phase resolved: No elimination this round. ${result.info}`,
    });
  } catch (err) {
    console.error(`[votes] Phase resolution failed for game=${gameId}:`, err);
    chatPost("/broadcast", {
      gameId,
      text: `Phase resolution failed. Manual intervention may be needed.`,
    });
  }
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
  // Reject votes from dead players.
  const aliveRows = await runPreparedQuery(
    getAliveSnapshots.run({ game_id: gameId, round, phase }, dbConn),
    "getAliveSnapshots",
  );
  if (aliveRows.length > 0) {
    const aliveSet = new Set(aliveRows.map((r) => r.player_idx));
    if (!aliveSet.has(voterIndex)) {
      console.warn(
        `[votes] Rejected vote from dead player: game=${gameId} round=${round} phase=${phase} voter=${voterIndex}`,
      );
      return { success: false };
    }
  }

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
    const keyHex = rows.length > 0 ? rows[0].admin_sign_public_key : null;
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

/** Derive the winning faction from persisted columns. Returns null while the game is active. */
function winnerOf(
  finished: boolean,
  werewolfCount: number,
): "VILLAGERS" | "WEREWOLVES" | null {
  if (!finished) return null;
  return werewolfCount === 0 ? "VILLAGERS" : "WEREWOLVES";
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
    winner: winnerOf(row.finished, Number(row.werewolf_count)),
    werewolfIndices,
    updatedBlock: typeof row.updated_block === "string"
      ? Number(row.updated_block)
      : row.updated_block,
  };
}

export async function openLobbyHandler(dbConn: Pool) {
  const res = await dbConn.query(
    "SELECT game_id, player_count, max_players FROM werewolf_lobby WHERE closed = FALSE ORDER BY game_id DESC LIMIT 1",
  );
  if (res.rows.length === 0) {
    throw Object.assign(new Error("No open lobby"), { statusCode: 404 });
  }
  const row = res.rows[0];
  return {
    gameId: Number(row.game_id),
    playerCount: Number(row.player_count),
    maxPlayers: Number(row.max_players),
  };
}

export async function getLeaderboardHandler(
  dbConn: Pool,
  limit: number,
  offset: number,
): Promise<{ entries: IGetLeaderboardResult[] }> {
  const rows = await runPreparedQuery(
    getLeaderboard.run({ limit, offset }, dbConn),
    "getLeaderboard",
  );
  return { entries: rows };
}

// ---------------------------------------------------------------------------
// Admin API Handlers (localhost-only)
// ---------------------------------------------------------------------------

const Role: Record<number, string> = {
  0: "Villager",
  1: "Werewolf",
  2: "Seer",
  3: "Doctor",
};

/** Get current NTP block from sync state. Returns null if DB not initialized. */
async function getCurrentNtpBlock(dbConn: Pool): Promise<number | null> {
  try {
    const result = await dbConn.query(
      `SELECT page_number, page
       FROM effectstream.sync_protocol_pagination
       WHERE protocol_name = 'mainNtp'
       ORDER BY page_number ASC
       LIMIT 1`,
    );
    if (!result?.rows?.length) return null;
    const row = result.rows[0] as {
      page_number: number;
      page: { root: number };
    };
    const startTime = row.page.root - (row.page_number * 1000);
    return Math.floor((Date.now() - startTime) / 1000);
  } catch {
    return null;
  }
}

/** List all games with current state. */
export async function adminListGamesHandler(dbConn: Pool) {
  const res = await dbConn.query(
    `SELECT gv.game_id, gv.phase, gv.round, gv.player_count, gv.alive_count,
            gv.werewolf_count, gv.villager_count, gv.finished
     FROM werewolf_game_view gv
     ORDER BY gv.game_id DESC
     LIMIT 50`,
  );

  // Also get open lobbies that may not have a game view yet
  const lobbyRes = await dbConn.query(
    `SELECT game_id, player_count, max_players, closed, bundles_ready, timeout_block
     FROM werewolf_lobby
     ORDER BY game_id DESC
     LIMIT 50`,
  );

  const currentBlock = await getCurrentNtpBlock(dbConn);

  return {
    currentBlock,
    games: res.rows.map((row: any) => ({
      gameId: Number(row.game_id),
      phase: row.phase,
      round: Number(row.round),
      playerCount: Number(row.player_count),
      aliveCount: Number(row.alive_count),
      werewolfCount: Number(row.werewolf_count),
      villagerCount: Number(row.villager_count),
      finished: row.finished,
      winner: winnerOf(row.finished, Number(row.werewolf_count)),
    })),
    lobbies: lobbyRes.rows.map((row: any) => ({
      gameId: Number(row.game_id),
      playerCount: Number(row.player_count),
      maxPlayers: Number(row.max_players),
      closed: row.closed,
      bundlesReady: row.bundles_ready,
      timeoutBlock: row.timeout_block != null
        ? Number(row.timeout_block)
        : null,
    })),
  };
}

/** Full game state including decrypted roles (from bundles). */
export async function adminGameStateHandler(dbConn: Pool, gameId: number) {
  // Game view from DB
  const rows = await runPreparedQuery(
    getGameView.run({ game_id: gameId }, dbConn),
    "getGameView",
  );

  const gameView = rows.length > 0
    ? (() => {
      const row = rows[0];
      const aliveVector: boolean[] = JSON.parse(row.alive_vector);
      return {
        phase: row.phase as string,
        round: Number(row.round),
        playerCount: Number(row.player_count),
        aliveCount: Number(row.alive_count),
        werewolfCount: Number(row.werewolf_count),
        villagerCount: Number(row.villager_count),
        finished: row.finished as boolean,
        aliveVector,
      };
    })()
    : null;

  // Player roles from bundles
  const bundles = store.getAllBundlesForGame(gameId);
  const players = bundles.map((b) => ({
    playerId: b.playerId,
    role: b.role != null ? (Role[b.role] ?? `Unknown(${b.role})`) : "Unknown",
    roleId: b.role ?? -1,
    alive: gameView ? (gameView.aliveVector[b.playerId] ?? false) : true,
  }));

  // Player nicknames from DB
  const playerRows = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );
  const nicknames = new Map<string, string>();
  for (const row of playerRows) {
    nicknames.set(row.public_key_hex, row.nickname ?? "");
  }
  // Match bundles to nicknames by join order (bundles[i] = playerRows[i])
  for (let i = 0; i < players.length && i < playerRows.length; i++) {
    (players[i] as any).nickname = playerRows[i].nickname ?? `Player ${i}`;
  }

  // Current vote status
  const currentPhase = gameView?.phase?.toUpperCase() ?? "";
  const currentRound = gameView?.round ?? 0;
  const voteCount = (currentPhase === "NIGHT" || currentPhase === "DAY")
    ? store.countVotes(gameId, currentRound, currentPhase)
    : 0;

  return {
    gameId,
    gameView,
    players,
    voteStatus: {
      round: currentRound,
      phase: currentPhase,
      voteCount,
      aliveCount: gameView?.aliveCount ?? 0,
    },
    hasSecrets: store.getGameSecrets(gameId) != null,
    hasMerkleRoot: store.getMerkleRoot(gameId) != null,
  };
}

/** Decrypt and return votes for a specific round/phase. */
export function adminDecryptedVotesHandler(
  gameId: number,
  round: number,
  phase: string,
) {
  const votes = store.getVotes(gameId, round, phase);
  if (votes.length === 0) {
    return { gameId, round, phase, votes: [], decrypted: [] };
  }

  try {
    const decrypted = decryptVotes(gameId, round, phase);
    return {
      gameId,
      round,
      phase,
      rawVoteCount: votes.length,
      decrypted: decrypted.map((v) => ({
        voterIndex: v.voterIndex,
        target: v.target,
      })),
    };
  } catch (err: any) {
    return {
      gameId,
      round,
      phase,
      rawVoteCount: votes.length,
      decrypted: [],
      error: err.message,
    };
  }
}

/**
 * Return all games a given EVM address has participated in, with current
 * lobby and game-view state so the frontend can offer a rejoin option for
 * any game that is still in progress.
 */
export async function getPlayerGamesHandler(dbConn: Pool, evmAddress: string) {
  const rows = await runPreparedQuery(
    getGamesByEvmAddress.run({ evm_address: evmAddress }, dbConn),
    "getGamesByEvmAddress",
  ) as IGetGamesByEvmAddressResult[];
  return {
    evmAddress,
    games: rows.map((r) => ({
      gameId: Number(r.game_id),
      playerIdx: r.player_idx ?? null,
      role: r.role ?? null,
      publicKeyHex: r.public_key_hex,
      nickname: r.nickname,
      closed: r.closed ?? false,
      bundlesReady: r.bundles_ready ?? false,
      phase: r.phase ?? null,
      round: r.round != null ? Number(r.round) : null,
      finished: r.finished ?? false,
    })),
  };
}
