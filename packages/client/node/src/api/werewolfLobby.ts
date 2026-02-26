import type { Pool } from "pg";
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
  // Create game record in database
  await upsertLobby.run(
    {
      game_id: gameId,
      max_players: maxPlayers,
      created_block: 0,
    },
    dbConn,
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
  // Add player to lobby in database
  await insertLobbyPlayer.run(
    {
      game_id: gameId,
      midnight_address_hash: midnightAddressHash,
      joined_block: 0,
    },
    dbConn,
  );
  await incrementLobbyPlayerCount.run(
    { game_id: gameId },
    dbConn,
  );
  return { success: true };
}

export async function closeGameHandler(dbConn: Pool, gameId: number) {
  await closeLobby.run({ game_id: gameId }, dbConn);
  return { success: true };
}

export async function getGameStateHandler(dbConn: Pool, gameId: number) {
  const lobbyRows = await getLobby.run({ game_id: gameId }, dbConn);
  if (lobbyRows.length === 0) {
    throw new Error(`Game ${gameId} not found`);
  }
  const lobby = lobbyRows[0];
  return {
    id: lobby.game_id,
    state: lobby.closed ? ("Closed" as const) : ("Open" as const),
    playerCount: lobby.player_count,
    maxPlayers: lobby.max_players,
  };
}

export async function getPlayersHandler(dbConn: Pool, gameId: number) {
  const players = await getLobbyPlayers.run({ game_id: gameId }, dbConn);
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
