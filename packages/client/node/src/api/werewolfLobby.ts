import type { Pool } from "pg";
import {
  getWerewolfContractClient,
} from "@werewolf-game/evm-contracts";

export async function createGameHandler(
  _dbConn: Pool,
  gameId: number,
  maxPlayers: number,
) {
  const client = getWerewolfContractClient();
  const result = await client.createGame(gameId, maxPlayers);
  return {
    gameId: Number(result.gameId),
    state: "Open" as const,
  };
}

export async function joinGameHandler(
  _dbConn: Pool,
  gameId: number,
  midnightAddressHash: string,
) {
  const client = getWerewolfContractClient();
  const result = await client.joinGame(gameId, midnightAddressHash);
  return { success: result.success };
}

export async function closeGameHandler(_dbConn: Pool, gameId: number) {
  const client = getWerewolfContractClient();
  const result = await client.closeGame(gameId);
  return { success: result.success };
}

export async function getGameStateHandler(_dbConn: Pool, gameId: number) {
  const client = getWerewolfContractClient();
  const game = await client.getGame(gameId);
  return {
    id: Number(game.id),
    state: game.state === 0 ? ("Open" as const) : ("Closed" as const),
    playerCount: Number(game.playerCount),
    maxPlayers: Number(game.maxPlayers),
  };
}

export async function getPlayersHandler(_dbConn: Pool, gameId: number) {
  const client = getWerewolfContractClient();
  const players = await client.getPlayers(gameId);
  return {
    gameId,
    players,
  };
}
