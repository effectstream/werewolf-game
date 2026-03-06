import { type Static, Type } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { StartConfigApiRouter } from "@paimaexample/runtime";
import type fastify from "fastify";
import { setDbPool } from "./db-pool.ts";
import { scheduleNextLobby } from "./lobby-closer.ts";
import {
  closeGameHandler,
  createGameHandler,
  getBundleHandler,
  getGameStateHandler,
  getGameViewHandler,
  getPlayersHandler,
  getVotesForRoundHandler,
  getVoteStatusHandler,
  joinGameHandler,
  lobbyStatusHandler,
  openLobbyHandler,
  submitVoteHandler,
} from "./api/werewolfLobby.ts";
import {
  CloseGameQuerystringSchema,
  CloseGameResponseSchema,
  CreateGameBodySchema,
  CreateGameResponseSchema,
  GenericErrorResponseSchema,
  GetBundleQuerystringSchema,
  GetBundleResponseSchema,
  GetGameStateQuerystringSchema,
  GetGameStateResponseSchema,
  GetGameViewQuerystringSchema,
  GetGameViewResponseSchema,
  GetPlayersQuerystringSchema,
  GetPlayersResponseSchema,
  GetVotesForRoundQuerystringSchema,
  GetVotesForRoundResponseSchema,
  GetVoteStatusQuerystringSchema,
  GetVoteStatusResponseSchema,
  JoinGameQuerystringSchema,
  JoinGameResponseSchema,
  LobbyStatusQuerystringSchema,
  LobbyStatusResponseSchema,
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
  // Store the database pool for use by lobby-closer and other modules
  setDbPool(dbConn);

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
      const { gameId, maxPlayers } = request.body;
      try {
        return await createGameHandler(
          dbConn,
          Number(gameId),
          maxPlayers,
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
    const { gameId, publicKey, nickname } = request.query;
    try {
      return await joinGameHandler(
        dbConn,
        Number(gameId),
        publicKey,
        nickname,
      );
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  server.get<{
    Querystring: Static<typeof GetBundleQuerystringSchema>;
    Reply: Static<
      typeof GetBundleResponseSchema | typeof GenericErrorResponseSchema
    >;
  }>("/api/get_bundle", async (request, reply) => {
    const { gameId, publicKeyHex, timestamp, signature } = request.query;
    try {
      return await getBundleHandler(
        dbConn,
        Number(gameId),
        publicKeyHex,
        timestamp,
        signature,
      );
    } catch (err: any) {
      if (err?.statusCode === 403) {
        return reply.status(403).send({ error: err.message });
      }
      if (err?.statusCode === 404) {
        return reply.status(404).send({ error: err.message });
      }
      if (err?.statusCode === 425) {
        return reply.status(425).send({ error: err.message });
      }
      throw err;
    }
  });

  server.get<{
    Querystring: Static<typeof LobbyStatusQuerystringSchema>;
    Reply: Static<
      typeof LobbyStatusResponseSchema | typeof GenericErrorResponseSchema
    >;
  }>("/api/lobby_status", async (request, reply) => {
    const { gameId } = request.query;
    try {
      return await lobbyStatusHandler(dbConn, Number(gameId));
    } catch (err: any) {
      if (err?.statusCode === 404) {
        return reply.status(404).send({ error: err.message });
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
    Reply: Static<
      typeof SubmitVoteResponseSchema | typeof GenericErrorResponseSchema
    >;
  }>(
    "/api/submit_vote",
    { schema: { body: SubmitVoteBodySchema } },
    async (request, reply) => {
      const {
        gameId,
        round,
        phase,
        voterIndex,
        targetIndex,
        encryptedVoteHex,
        merklePathJson,
      } = request.body;
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

  server.get<{
    Querystring: Static<typeof GetVotesForRoundQuerystringSchema>;
    Reply: Static<
      typeof GetVotesForRoundResponseSchema | typeof GenericErrorResponseSchema
    >;
  }>("/api/votes_for_round", async (request, reply) => {
    const { gameId, round, phase, timestamp, signature } = request.query;
    try {
      return await getVotesForRoundHandler(
        dbConn,
        Number(gameId),
        Number(round),
        phase,
        timestamp,
        signature,
      );
    } catch (err: any) {
      if (err?.statusCode === 400) {
        return reply.status(400).send({ error: err.message });
      }
      if (err?.statusCode === 403) {
        return reply.status(403).send({ error: err.message });
      }
      throw err;
    }
  });

  server.get("/api/open_lobby", async (_request, reply) => {
    try {
      return await openLobbyHandler(dbConn);
    } catch (err: any) {
      if (err?.statusCode === 404) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // Bootstrap: ensure at least one open lobby exists on startup.
  // Retries until werewolf_lobby exists (migrations may not be done yet).
  // -------------------------------------------------------------------------
  void (async () => {
    const RETRY_MS = 2_000;
    const TIMEOUT_MS = 60_000;
    const deadline = Date.now() + TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const res = await dbConn.query(
          "SELECT COUNT(*) AS cnt FROM werewolf_lobby WHERE closed = FALSE",
        );
        const count = parseInt(res.rows[0]?.cnt ?? "0", 10);
        if (count === 0) {
          console.log(
            "[api] No open lobby found — scheduling initial lobby creation",
          );
          await scheduleNextLobby();
        } else {
          console.log(
            `[api] Found ${count} open lobby(ies) — skipping bootstrap`,
          );
        }
        return; // done
      } catch (err: any) {
        if (
          err?.message?.includes("relation") &&
          err?.message?.includes("does not exist")
        ) {
          console.log(
            "[api] werewolf_lobby not ready yet — retrying bootstrap in 2s…",
          );
          await new Promise((r) => setTimeout(r, RETRY_MS));
        } else {
          console.warn("[api] Bootstrap lobby check failed:", err);
          return; // unexpected error — don't retry
        }
      }
    }
    console.warn(
      "[api] Bootstrap timed out waiting for werewolf_lobby — no lobby created",
    );
  })();
};
