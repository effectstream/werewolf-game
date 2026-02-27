import { type Static, Type } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { StartConfigApiRouter } from "@paimaexample/runtime";
import type fastify from "fastify";
import {
  closeGameHandler,
  createGameHandler,
  getGameStateHandler,
  getGameViewHandler,
  getPlayersHandler,
  getVoteStatusHandler,
  joinGameHandler,
  submitVoteHandler,
} from "./api/werewolfLobby.ts";
import {
  CloseGameQuerystringSchema,
  CloseGameResponseSchema,
  CreateGameBodySchema,
  CreateGameResponseSchema,
  GenericErrorResponseSchema,
  GetGameStateQuerystringSchema,
  GetGameStateResponseSchema,
  GetGameViewQuerystringSchema,
  GetGameViewResponseSchema,
  GetPlayersQuerystringSchema,
  GetPlayersResponseSchema,
  GetVoteStatusQuerystringSchema,
  GetVoteStatusResponseSchema,
  JoinGameQuerystringSchema,
  JoinGameResponseSchema,
  SubmitVoteBodySchema,
  SubmitVoteResponseSchema,
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
    Body: Static<typeof CreateGameBodySchema>;
    Reply: Static<
      | typeof CreateGameResponseSchema
      | typeof GenericErrorResponseSchema
    >;
  }>(
    "/api/create_game",
    { schema: { body: CreateGameBodySchema } },
    async (request, reply) => {
      const { gameId, maxPlayers, playerBundles } = request.body;
      try {
        return await createGameHandler(
          dbConn,
          Number(gameId),
          maxPlayers,
          playerBundles,
        );
      } catch (err: any) {
        if (err?.statusCode === 400) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  server.post<{
    Querystring: Static<typeof JoinGameQuerystringSchema>;
    Reply: Static<
      typeof JoinGameResponseSchema | typeof GenericErrorResponseSchema
    >;
  }>("/api/join_game", async (request, reply) => {
    const { gameId, midnightAddressHash } = request.query;
    try {
      return await joinGameHandler(dbConn, gameId, midnightAddressHash);
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
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

  server.get<{
    Querystring: Static<typeof GetGameViewQuerystringSchema>;
    Reply: Static<typeof GetGameViewResponseSchema>;
  }>("/api/game_view", async (request) => {
    const { gameId } = request.query;
    return await getGameViewHandler(dbConn, gameId);
  });

  server.post<{
    Body: Static<typeof SubmitVoteBodySchema>;
    Reply: Static<typeof SubmitVoteResponseSchema | typeof GenericErrorResponseSchema>;
  }>(
    "/api/submit_vote",
    { schema: { body: SubmitVoteBodySchema } },
    async (request, reply) => {
      const { gameId, round, phase, voterIndex, targetIndex, encryptedVoteHex, merklePathJson } =
        request.body;
      try {
        return await submitVoteHandler(
          dbConn,
          Number(gameId),
          round,
          phase,
          voterIndex,
          targetIndex,
          encryptedVoteHex,
          merklePathJson,
        );
      } catch (err: any) {
        return reply.status(500).send({ error: String(err?.message ?? err) });
      }
    },
  );

  server.get<{
    Querystring: Static<typeof GetVoteStatusQuerystringSchema>;
    Reply: Static<typeof GetVoteStatusResponseSchema>;
  }>("/api/vote_status", async (request) => {
    const { gameId, round, phase } = request.query;
    return await getVoteStatusHandler(dbConn, Number(gameId), round, phase);
  });
};
