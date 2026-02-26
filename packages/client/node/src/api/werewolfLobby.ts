import type { Pool } from "pg";
import { runPreparedQuery } from "@paimaexample/db";
import {
  closeLobby,
  getLobby,
  getLobbyPlayers,
  insertLobbyPlayer,
  incrementLobbyPlayerCount,
  upsertLobby,
} from "@werewolf-game/database";

export async function createGameHandler(
  dbConn: Pool,
  gameId: number,
  maxPlayers: number,
) {
  await runPreparedQuery(
    upsertLobby.run({ game_id: gameId, max_players: maxPlayers, created_block: 0 }, dbConn),
    "upsertLobby",
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
) {
  await runPreparedQuery(
    insertLobbyPlayer.run({ game_id: gameId, midnight_address_hash: midnightAddressHash, joined_block: 0 }, dbConn),
    "insertLobbyPlayer",
  );
  await runPreparedQuery(
    incrementLobbyPlayerCount.run({ game_id: gameId }, dbConn),
    "incrementLobbyPlayerCount",
  );
  return { success: true };
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
