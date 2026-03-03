import type { Pool } from "pg";
import { runPreparedQuery } from "@paimaexample/db";
import {
  closeLobby,
  countBundles,
  countVotesForRound,
  getGameView,
  getLobby,
  getLobbyPlayerBundle,
  getLobbyPlayers,
  getVotesForRound,
  insertBundle,
  insertLobbyPlayer,
  incrementLobbyPlayerCount,
  insertPlayerVote,
  popBundle,
  getRoundState,
  setLobbyPlayerBundle,
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

  if (alreadyJoined) {
    // The player is in the lobby. Check whether they already have a bundle
    // assigned (idempotent re-join / page-refresh case).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundleRows = await runPreparedQuery(
      (getLobbyPlayerBundle as any).run({ game_id: gameId, midnight_address_hash: midnightAddressHash }, dbConn),
      "getLobbyPlayerBundle",
    ) as { bundle: string | null }[];
    const storedBundle = bundleRows[0]?.bundle
      ? JSON.parse(bundleRows[0].bundle) as PlayerBundle
      : undefined;

    if (storedBundle) {
      // Bundle already assigned — just return it (idempotent).
      console.log(`[lobby] Player ${midnightAddressHash} re-joined game ${gameId}, returning existing bundle.`);
      return { success: true, bundle: storedBundle };
    }

    // The state machine pre-registered this player but no bundle was assigned
    // yet. Pop one now (same as the new-player path below).
    console.log(`[lobby] Player ${midnightAddressHash} already in lobby but has no bundle — assigning one now.`);
  }

  // Check that there are still bundles left (slots open).
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

  if (!alreadyJoined) {
    // First time joining via this API — insert the player and increment count.
    // (When the state machine fires later it will hit ON CONFLICT DO NOTHING.)
    await runPreparedQuery(
      insertLobbyPlayer.run({ game_id: gameId, midnight_address_hash: midnightAddressHash, nickname, joined_block: 0 }, dbConn),
      "insertLobbyPlayer",
    );
    await runPreparedQuery(
      incrementLobbyPlayerCount.run({ game_id: gameId }, dbConn),
      "incrementLobbyPlayerCount",
    );

    // Invite the player to the chat room immediately so they can connect to the
    // WebSocket without waiting for the STF to process the batcher transaction.
    chatPost("/invite", { gameId, midnightAddressHash, nickname });
  }

  // Pop one bundle from the pool.
  const popRows = await runPreparedQuery(
    popBundle.run({ game_id: gameId }, dbConn),
    "popBundle",
  );
  const bundle: PlayerBundle | undefined = popRows[0]
    ? JSON.parse(popRows[0].bundle)
    : undefined;

  // If the player is a werewolf, also invite them to the werewolf-only channel.
  if (bundle?.role === 1) {
    chatPost("/invite", { gameId, midnightAddressHash, nickname, channel: "werewolf" });
  }

  // Persist the assigned bundle so we can return it on re-join/page-refresh.
  if (bundle) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runPreparedQuery(
      (setLobbyPlayerBundle as any).run({
        game_id: gameId,
        midnight_address_hash: midnightAddressHash,
        bundle: JSON.stringify(bundle),
      }, dbConn),
      "setLobbyPlayerBundle",
    );
  }

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
      nickname: p.nickname,
      playerId: p.player_id !== null && p.player_id !== undefined
        ? (typeof p.player_id === 'string' ? Number(p.player_id) : p.player_id)
        : undefined,
    })),
  };
}

async function triggerMidnightVoteSubmission(
  dbConn: Pool,
  gameId: number,
  round: number,
  phase: string,
): Promise<void> {
  const votes = await runPreparedQuery(
    getVotesForRound.run({ game_id: gameId, round, phase }, dbConn),
    "getVotesForRound",
  );

  console.log(
    `[votes] All ${votes.length} votes collected for game=${gameId} round=${round} phase=${phase}.` +
    ` The dApp (trusted node) will decrypt, submit to chain, and resolve the phase via its polling loop.`,
  );

  // Notify all players in chat that voting has closed.
  // Chain submission and phase resolution are handled by the dApp's auto-vote polling loop,
  // which decrypts votes using the admin keypair and calls nightAction()/voteDay() + resolve
  // on the Midnight contract.
  chatPost("/broadcast", {
    gameId,
    text: `All votes received for round ${round} (${phase}). Processing results…`,
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

export async function getVotesForRoundHandler(
  dbConn: Pool,
  gameId: number,
  round: number,
  phase: string,
): Promise<{ votes: { voterIndex: number; encryptedVoteHex: string; merklePathJson: string }[] }> {
  const rows = await runPreparedQuery(
    getVotesForRound.run({ game_id: gameId, round, phase }, dbConn),
    "getVotesForRound",
  );
  return {
    votes: rows.map((r) => ({
      voterIndex: r.voter_index,
      encryptedVoteHex: r.encrypted_vote,
      merklePathJson: r.merkle_path,
    })),
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
