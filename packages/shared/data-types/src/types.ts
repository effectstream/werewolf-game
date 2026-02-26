import { Type } from "@sinclair/typebox";

export const CreateGameQuerystringSchema = Type.Object({
  gameId: Type.Number(),
  maxPlayers: Type.Number(),
});

export const CreateGameResponseSchema = Type.Object({
  gameId: Type.Number(),
  state: Type.Union([
    Type.Literal("Open"),
    Type.Literal("Closed"),
  ]),
});

export const JoinGameQuerystringSchema = Type.Object({
  gameId: Type.Number(),
  midnightAddressHash: Type.String(),
});

export const JoinGameResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
});

export const CloseGameQuerystringSchema = Type.Object({
  gameId: Type.Number(),
});

export const CloseGameResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
});

export const GetGameStateQuerystringSchema = Type.Object({
  gameId: Type.Number(),
});

export const GetGameStateResponseSchema = Type.Object({
  id: Type.Number(),
  state: Type.Union([
    Type.Literal("Open"),
    Type.Literal("Closed"),
  ]),
  playerCount: Type.Number(),
  maxPlayers: Type.Number(),
});

export const GetPlayersQuerystringSchema = Type.Object({
  gameId: Type.Number(),
});

export const PlayerInfoSchema = Type.Object({
  evmAddress: Type.String(),
  midnightAddressHash: Type.String(),
});

export const GetPlayersResponseSchema = Type.Object({
  gameId: Type.Number(),
  players: Type.Array(PlayerInfoSchema),
});
