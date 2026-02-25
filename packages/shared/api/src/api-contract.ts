import { initContract } from '@ts-rest/core';
import { Zod } from '@sinclair/typemap';
import {
  CreateGameQuerystringSchema,
  CreateGameResponseSchema,
  JoinGameQuerystringSchema,
  JoinGameResponseSchema,
  CloseGameQuerystringSchema,
  CloseGameResponseSchema,
  GetGameStateQuerystringSchema,
  GetGameStateResponseSchema,
  GetPlayersQuerystringSchema,
  GetPlayersResponseSchema,
} from '@werewolf-game/data-types/types';

const c = initContract();

export const apiWerewolfContract = c.router({
  createGame: {
    method: 'POST',
    path: '/api/create_game',
    query: Zod(CreateGameQuerystringSchema),
    responses: {
      200: Zod(CreateGameResponseSchema)
    }
  },
  joinGame: {
    method: 'POST',
    path: '/api/join_game',
    query: Zod(JoinGameQuerystringSchema),
    responses: {
      200: Zod(JoinGameResponseSchema)
    }
  },
  closeGame: {
    method: 'POST',
    path: '/api/close_game',
    query: Zod(CloseGameQuerystringSchema),
    responses: {
      200: Zod(CloseGameResponseSchema)
    }
  },
  getGameState: {
    method: 'GET',
    path: '/api/game_state',
    query: Zod(GetGameStateQuerystringSchema),
    responses: {
      200: Zod(GetGameStateResponseSchema)
    }
  },
  getPlayers: {
    method: 'GET',
    path: '/api/game_players',
    query: Zod(GetPlayersQuerystringSchema),
    responses: {
      200: Zod(GetPlayersResponseSchema)
    }
  },
});
