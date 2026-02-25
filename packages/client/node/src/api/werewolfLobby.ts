import type { Pool } from "pg";
import type { ApiRouter } from "@paimaexample/runtime";
import type fastify from "fastify";
import { createGameHandler, joinGameHandler, closeGameHandler, getGameStateHandler, getPlayersHandler } from "./api/werewolfLobby";
import { apiWerewolfContract } from "@werewolf-game/api";
import { initWerewolfContractClient } from "@werewolf-game/evm-contracts";

export const apiWerewolfHandlers: ApiRouter = async function (
  server: fastify.FastifyInstance,
  dbConn: Pool,
): Promise<void> {

  // Initialize contract client with actual configuration
  initWerewolfContractClient(
    server,
    "YOUR_CONTRACT_ADDRESS",
    "http://localhost:8545"
  );

  return server.router(apiWerewolfContract, {
    createGame: async ({ query: { maxPlayers } }) => {
      const result = await createGameHandler(dbConn, parseInt(maxPlayers));
      return {
        status: 200,
        body: result,
      };
    },
    joinGame: async ({ query: { gameId, midnightAddressHash } }) => {
      const result = await joinGameHandler(dbConn, parseInt(gameId), midnightAddressHash);
      return {
        status: 200,
        body: result,
      };
    },
    closeGame: async ({ query: { gameId } }) => {
      const result = await closeGameHandler(dbConn, parseInt(gameId));
      return {
        status: 200,
        body: result,
      };
    },
    getGameState: async ({ query: { gameId } }) => {
      const result = await getGameStateHandler(dbConn, parseInt(gameId));
      return {
        status: 200,
        body: result,
      };
    },
    getPlayers: async ({ query: { gameId } }) => {
      const result = await getPlayersHandler(dbConn, parseInt(gameId));
      return {
        status: 200,
        body: result,
      };
    },
  });
};

// Initialize function to be called on startup
export function initWerewolfContractClient(
  chain: any,
  contractAddress: string,
  rpcUrl: string
): void {
  contractClient = createContractClient(
    chain,
    contractAddress,
    rpcUrl
  );
}
