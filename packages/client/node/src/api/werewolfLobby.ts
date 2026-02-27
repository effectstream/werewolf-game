import type { Pool } from "pg";
import { runPreparedQuery } from "@paimaexample/db";
import {
  closeLobby,
  countBundles,
  countVotesForRound,
  getGameView,
  getLobby,
  getLobbyPlayers,
  getVotesForRound,
  insertBundle,
  insertLobbyPlayer,
  incrementLobbyPlayerCount,
  insertPlayerVote,
  popBundle,
  getRoundState,
  updateRoundVoteCount,
  upsertLobby,
} from "@werewolf-game/database";

const CHAT_SERVER_URL = Deno.env.get("CHAT_SERVER_URL") ?? "http://localhost:3001";

function chatPost(path: string, body: unknown): void {
  void fetch(`${CHAT_SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => console.warn(`[chat] POST ${path} failed:`, err));
}

type PlayerBundle = {
  gameId: string;
  playerId: number;
  leafSecret: string;
  merklePath: { sibling: { field: string }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
};

export async function createGameHandler(
  dbConn: Pool,
  gameId: number,
  maxPlayers: number,
  playerBundles: PlayerBundle[],
) {
  if (maxPlayers < 5) {
    throw Object.assign(new Error("Minimum 5 players required."), { statusCode: 400 });
  }

  await runPreparedQuery(
    upsertLobby.run({ game_id: gameId, max_players: maxPlayers, created_block: 0 }, dbConn),
    "upsertLobby",
  );

  // Persist the pre-shuffled bundles to the DB so they survive restarts.
  // The Trusted Node shuffles roles before computing bundles, so the order is
  // already random — we insert them as-is and pop from the highest id.
  for (const bundle of playerBundles) {
    await runPreparedQuery(
      insertBundle.run({ game_id: gameId, bundle: JSON.stringify(bundle) }, dbConn),
      "insertBundle",
    );
  }
  console.log(`[lobby] Stored ${playerBundles.length} bundles for game=${gameId}`);

  return {
    gameId,
    state: "Open" as const,
  };
}

export async function joinGameHandler(
  dbConn: Pool,
  gameId: number,
  midnightAddressHash: string,
) {
  // Guard: game must have bundles remaining (i.e. createGame was called and
  // slots are still open). Using the DB count survives node restarts.
  const countRows = await runPreparedQuery(
    countBundles.run({ game_id: gameId }, dbConn),
    "countBundles",
  );
  const remaining = Number(countRows[0]?.remaining ?? 0);
  if (remaining === 0) {
    throw Object.assign(
      new Error("Game not found or already started."),
      { statusCode: 409 },
    );
  }

  // Guard: prevent double-join consuming a second bundle.
  const existingPlayers = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );
  const alreadyJoined = existingPlayers.some(
    (p) => p.midnight_address_hash === midnightAddressHash,
  );
  if (alreadyJoined) {
    return { success: true, message: "Already joined." };
  }

  await runPreparedQuery(
    insertLobbyPlayer.run({ game_id: gameId, midnight_address_hash: midnightAddressHash, joined_block: 0 }, dbConn),
    "insertLobbyPlayer",
  );
  await runPreparedQuery(
    incrementLobbyPlayerCount.run({ game_id: gameId }, dbConn),
    "incrementLobbyPlayerCount",
  );

  // Invite the player to the chat room immediately so they can connect to the
  // WebSocket without waiting for the STF to process the batcher transaction.
  chatPost("/invite", { gameId, midnightAddressHash });

  // Atomically pop one bundle from the DB.
  const popRows = await runPreparedQuery(
    popBundle.run({ game_id: gameId }, dbConn),
    "popBundle",
  );
  const bundle: PlayerBundle | undefined = popRows[0]
    ? JSON.parse(popRows[0].bundle)
    : undefined;

  let gameStarted = false;

  // remaining was checked before the pop, so after the pop there are remaining-1 left.
  if (remaining - 1 === 0) {
    // Last slot filled — start the game.
    await runPreparedQuery(closeLobby.run({ game_id: gameId }, dbConn), "closeLobby");
    chatPost("/broadcast", {
      gameId,
      text: "GAME_STARTED: All players have joined. The game begins now.",
    });
    gameStarted = true;
    console.log(`[lobby] Game ${gameId} started — all slots filled.`);
  }

  return { success: true, bundle, gameStarted };
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
    id: typeof lobby.game_id === 'string' ? Number(lobby.game_id) : lobby.game_id,
    state: lobby.closed ? ("Closed" as const) : ("Open" as const),
    playerCount: typeof lobby.player_count === 'string' ? Number(lobby.player_count) : lobby.player_count,
    maxPlayers: typeof lobby.max_players === 'string' ? Number(lobby.max_players) : lobby.max_players,
  };
}

export async function getPlayersHandler(dbConn: Pool, gameId: number) {
  const players = await runPreparedQuery(
    getLobbyPlayers.run({ game_id: gameId }, dbConn),
    "getLobbyPlayers",
  );
  return {
    gameId,
    players: players.map((p) => ({
      // evmAddress is not stored in the DB — it is only available on-chain via
      // the PlayerJoined event. Callers that need EVM addresses should read
      // getPlayers() directly from the EVM contract.
      evmAddress: "",
      midnightAddressHash: p.midnight_address_hash,
    })),
  };
}

async function triggerMidnightVoteSubmission(
  dbConn: Pool,
  gameId: number,
  round: number,
  phase: string,
): Promise<void> {
  console.log(
    `[votes] All votes in for game=${gameId} round=${round} phase=${phase}. Triggering resolution.`,
  );

  const votes = await runPreparedQuery(
    getVotesForRound.run({ game_id: gameId, round, phase }, dbConn),
    "getVotesForRound",
  );

  console.log(`[votes] Collected ${votes.length} votes:`, votes.map((v) => ({
    voterIndex: v.voter_index,
    encryptedVote: v.encrypted_vote,
  })));

  // TODO: Admin node decrypts each vote using admin private vote key, tallies,
  // then calls resolveDayPhase / resolveNightPhase via Midnight SDK.

  chatPost("/broadcast", {
    gameId,
    text: `All votes received for round ${round} (${phase}). Processing results.`,
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
  await runPreparedQuery(
    insertPlayerVote.run({
      game_id: gameId,
      round,
      phase,
      voter_index: voterIndex,
      encrypted_vote: encryptedVoteHex,
      merkle_path: merklePathJson,
    }, dbConn),
    "insertPlayerVote",
  );

  const countRows = await runPreparedQuery(
    countVotesForRound.run({ game_id: gameId, round, phase }, dbConn),
    "countVotesForRound",
  );
  const voteCount = Number(countRows[0]?.vote_count ?? 0);

  const roundRows = await runPreparedQuery(
    getRoundState.run({ game_id: gameId, round, phase }, dbConn),
    "getRoundState",
  );
  const aliveCount = roundRows.length > 0 ? Number(roundRows[0].alive_count) : null;

  // Sync vote count to round state so the timeout STF sees accurate numbers
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
    void triggerMidnightVoteSubmission(dbConn, gameId, round, phase).catch(
      (err) => console.error("[submitVote] Midnight submission failed:", err),
    );
  }

  console.log(
    `[votes] game=${gameId} round=${round} phase=${phase} voter=${voterIndex} target=${targetIndex} votes=${voteCount}/${aliveCount ?? "?"}`,
  );

  return { success: true, voteCount, aliveCount: aliveCount ?? 0, allVotesIn };
}

export async function getVoteStatusHandler(
  dbConn: Pool,
  gameId: number,
  round: number,
  phase: string,
): Promise<{ voteCount: number; aliveCount: number }> {
  const [countRows, roundRows] = await Promise.all([
    runPreparedQuery(
      countVotesForRound.run({ game_id: gameId, round, phase }, dbConn),
      "countVotesForRound",
    ),
    runPreparedQuery(
      getRoundState.run({ game_id: gameId, round, phase }, dbConn),
      "getRoundState",
    ),
  ]);
  return {
    voteCount: Number(countRows[0]?.vote_count ?? 0),
    aliveCount: roundRows.length > 0 ? Number(roundRows[0].alive_count) : 0,
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
    updatedBlock:
      typeof row.updated_block === "string"
        ? Number(row.updated_block)
        : row.updated_block,
  };
}
