/**
 * Preprod / Preview API router.
 *
 * This is the production-safe subset of api.ts:
 *   - /api/faucet/nights    REMOVED (dev-only, unsafe)
 *   - /debug/start_game     REMOVED (debug endpoint)
 *   - /api/admin/*          REMOVED (exposes roles, votes, and internal state)
 *
 * All remaining endpoints are safe for public-facing deployments.
 */

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
  getLeaderboardHandler,
  getPlayerGamesHandler,
  getPlayersHandler,
  getVotesForRoundHandler,
  getVoteStatusHandler,
  getWalletMappingHandler,
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
  LobbyStatusQuerystringSchema,
  LobbyStatusResponseSchema,
  PlayerGamesQuerystringSchema,
  PlayerGamesResponseSchema,
  SubmitVoteBodySchema,
  SubmitVoteResponseSchema,
} from "@werewolf-game/data-types/grammar";

/**
 * Preprod API router — public endpoints only.
 * No faucet, no debug, no admin routes.
 */
export const apiRouter: StartConfigApiRouter = async function (
  server: fastify.FastifyInstance,
  dbConn: Pool,
): Promise<void> {
  // Store the database pool for use by lobby-closer and other modules.
  setDbPool(dbConn);

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
        return await createGameHandler(dbConn, Number(gameId), maxPlayers);
      } catch (err: any) {
        if (err?.statusCode === 400) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

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

  server.get<{
    Querystring: Static<typeof PlayerGamesQuerystringSchema>;
    Reply: Static<typeof PlayerGamesResponseSchema | typeof GenericErrorResponseSchema>;
  }>("/api/player_games", async (request) => {
    const { evmAddress } = request.query;
    return getPlayerGamesHandler(dbConn, evmAddress);
  });

  server.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/api/leaderboard",
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 50), 100);
      const offset = Number(request.query.offset ?? 0);
      return getLeaderboardHandler(dbConn, limit, offset);
    },
  );

  server.get<{ Querystring: { evmAddress: string } }>(
    "/api/wallet_mapping",
    async (request, reply) => {
      const { evmAddress } = request.query;
      if (!evmAddress) {
        return reply.status(400).send({ error: "evmAddress query parameter is required" });
      }
      return getWalletMappingHandler(dbConn, evmAddress);
    },
  );

  // Exposes Midnight network config so the browser client can connect to the
  // correct indexer, proof server, and contract address.
  server.get("/api/midnight_config", async () => {
    const { readMidnightContract } = await import(
      "@paimaexample/midnight-contracts/read-contract"
    );
    const { midnightNetworkConfig } = await import(
      "@paimaexample/midnight-contracts/midnight-env"
    );
    const { contractAddress } = readMidnightContract("contract-werewolf", {
      networkId: midnightNetworkConfig.id,
    });
    return {
      contractAddress,
      networkId: midnightNetworkConfig.id,
      indexerUrl: midnightNetworkConfig.indexer,
      indexerWsUrl: midnightNetworkConfig.indexerWS,
      proofServerUrl: midnightNetworkConfig.proofServer,
      nodeUrl: midnightNetworkConfig.node,
    };
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
          const firstSeed: Uint8Array = new Uint8Array(32);
          firstSeed.fill(1);
          await scheduleNextLobby(firstSeed);
        } else {
          console.log(
            `[api] Found ${count} open lobby(ies) — skipping bootstrap`,
          );
        }
        return;
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
          return;
        }
      }
    }
    console.warn(
      "[api] Bootstrap timed out waiting for werewolf_lobby — no lobby created",
    );
  })();
};
