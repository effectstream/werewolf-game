import { type Static, Type } from "@sinclair/typebox";
import { runPreparedQuery } from "@paimaexample/db";
import {
  evmMidnightTableExists,
  getEvmMidnight,
} from "@werewolf-game/database";
import type { Pool } from "pg";
import type { StartConfigApiRouter } from "@paimaexample/runtime";
import type fastify from "fastify";
import { hardhat } from "npm:viem/chains";
import { initWerewolfContractClient } from "@werewolf-game/evm-contracts/client";
import {
  closeGameHandler,
  createGameHandler,
  getGameStateHandler,
  getPlayersHandler,
  joinGameHandler,
} from "./api/werewolfLobby.ts";
import {
  CloseGameQuerystringSchema,
  CloseGameResponseSchema,
  CreateGameQuerystringSchema,
  CreateGameResponseSchema,
  GetGameStateQuerystringSchema,
  GetGameStateResponseSchema,
  GetPlayersQuerystringSchema,
  GetPlayersResponseSchema,
  JoinGameQuerystringSchema,
  JoinGameResponseSchema,
} from "@werewolf-game/data-types/grammar";

const FaucetQueryParamsSchema = Type.Object({
  address: Type.String(),
});
const FaucetResponseSchema = Type.Object({
  status: Type.String(),
  message: Type.String(),
});
/** This is a faucet endpoint to get funds in the midnight network */
let isFaucetDustRunning = false;

/**
 * Example for User Defined API Routes.
 * Register custom endpoints here.
 * @param server - The Fastify instance.
 * @param dbConn - The database connection.
 */
export const apiRouter: StartConfigApiRouter = async function (
  server: fastify.FastifyInstance,
  dbConn: Pool,
): Promise<void> {
  // Initialise the EVM contract client once at startup.
  // Override via EVM_CONTRACT_ADDRESS / EVM_RPC_URL environment variables.
  initWerewolfContractClient(
    hardhat,
    Deno.env.get("EVM_CONTRACT_ADDRESS") ?? "YOUR_CONTRACT_ADDRESS",
    Deno.env.get("EVM_RPC_URL") ?? "http://localhost:8545",
  );

  server.get<{
    Querystring: Static<typeof FaucetQueryParamsSchema>;
    Reply: Static<typeof FaucetResponseSchema>;
  }>("/api/faucet/nights", async (request) => {
    // This is unsafe, but it's only used for development purposes.
    if (isFaucetDustRunning) {
      return {
        status: "error",
        message: "Faucet is already running",
      };
    }
    const { address } = request.query;
    // TODO Validate if the address is valid midnight address
    let status = "success";
    let message = "";
    try {
      isFaucetDustRunning = true;
      const command = new Deno.Command(Deno.execPath(), {
        env: {
          MIDNIGHT_ADDRESS: address,
        },
        args: [
          "task",
          "-f",
          "@example-midnight/midnight-contracts",
          "midnight-faucet:start",
        ],
      });
      const { code, stdout, stderr } = await command.output();
      status = "done";
      message = "Faucet successfully completed";
    } catch (error: any) {
      status = "error";
      message = String(error);
    } finally {
      isFaucetDustRunning = false;
    }

    return {
      status,
      message,
    };
  });

  // -------------------------------------------------------------------------
  // Werewolf Lobby API
  // -------------------------------------------------------------------------
  server.post<{
    Querystring: Static<typeof CreateGameQuerystringSchema>;
    Reply: Static<typeof CreateGameResponseSchema>;
  }>("/api/create_game", async (request) => {
    const { gameId, maxPlayers } = request.query;
    return await createGameHandler(dbConn, gameId, maxPlayers);
  });

  server.post<{
    Querystring: Static<typeof JoinGameQuerystringSchema>;
    Reply: Static<typeof JoinGameResponseSchema>;
  }>("/api/join_game", async (request) => {
    const { gameId, midnightAddressHash } = request.query;
    return await joinGameHandler(dbConn, gameId, midnightAddressHash);
  });

  server.post<{
    Querystring: Static<typeof CloseGameQuerystringSchema>;
    Reply: Static<typeof CloseGameResponseSchema>;
  }>("/api/close_game", async (request) => {
    const { gameId } = request.query;
    return await closeGameHandler(dbConn, gameId);
  });

  server.get<{
    Querystring: Static<typeof GetGameStateQuerystringSchema>;
    Reply: Static<typeof GetGameStateResponseSchema>;
  }>("/api/game_state", async (request) => {
    const { gameId } = request.query;
    return await getGameStateHandler(dbConn, gameId);
  });

  server.get<{
    Querystring: Static<typeof GetPlayersQuerystringSchema>;
    Reply: Static<typeof GetPlayersResponseSchema>;
  }>("/api/game_players", async (request) => {
    const { gameId } = request.query;
    return await getPlayersHandler(dbConn, gameId);
  });
};
