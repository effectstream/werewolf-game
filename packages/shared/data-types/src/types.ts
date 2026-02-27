import { Type } from "@sinclair/typebox";

export const MerklePathEntrySchema = Type.Object({
  sibling: Type.Object({ field: Type.String() }),
  goes_left: Type.Boolean(),
});

export const PlayerBundleSchema = Type.Object({
  gameId: Type.String(),
  playerId: Type.Number(),
  leafSecret: Type.String(),
  merklePath: Type.Array(MerklePathEntrySchema),
  adminVotePublicKeyHex: Type.String(),
  role: Type.Optional(Type.Number()),
});

export const CreateGameQuerystringSchema = Type.Object({
  gameId: Type.Number(),
  maxPlayers: Type.Number(),
});

export const CreateGameBodySchema = Type.Object({
  gameId: Type.String(),
  maxPlayers: Type.Number(),
  playerBundles: Type.Array(PlayerBundleSchema),
});

export const CreateGameResponseSchema = Type.Object({
  gameId: Type.Number(),
  state: Type.Union([
    Type.Literal("Open"),
    Type.Literal("Closed"),
  ]),
});

export const GenericErrorResponseSchema = Type.Object({
  error: Type.String(),
});

export const JoinGameQuerystringSchema = Type.Object({
  gameId: Type.Number(),
  midnightAddressHash: Type.String(),
});

export const JoinGameResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
  bundle: Type.Optional(PlayerBundleSchema),
  gameStarted: Type.Optional(Type.Boolean()),
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

export const GetGameViewQuerystringSchema = Type.Object({
  gameId: Type.Number(),
});

export const PlayerStatusSchema = Type.Object({
  index: Type.Number(),
  alive: Type.Boolean(),
});

export const GetGameViewResponseSchema = Type.Object({
  gameId: Type.Number(),
  phase: Type.String(),
  round: Type.Number(),
  playerCount: Type.Number(),
  aliveCount: Type.Number(),
  werewolfCount: Type.Number(),
  villagerCount: Type.Number(),
  players: Type.Array(PlayerStatusSchema),
  finished: Type.Boolean(),
  werewolfIndices: Type.Array(Type.Number()),
  updatedBlock: Type.Number(),
});

export const SubmitVoteBodySchema = Type.Object({
  gameId: Type.Number(),
  round: Type.Number(),
  phase: Type.String(),
  voterIndex: Type.Number(),
  targetIndex: Type.Number(),
  encryptedVoteHex: Type.String(),
  merklePathJson: Type.String(),
});

export const SubmitVoteResponseSchema = Type.Object({
  success: Type.Boolean(),
  alreadyVoted: Type.Optional(Type.Boolean()),
  allVotesIn: Type.Optional(Type.Boolean()),
  voteCount: Type.Optional(Type.Number()),
  aliveCount: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
});

export const GetVoteStatusQuerystringSchema = Type.Object({
  gameId: Type.Number(),
  round: Type.Number(),
  phase: Type.String(),
});

export const GetVoteStatusResponseSchema = Type.Object({
  voteCount: Type.Number(),
  aliveCount: Type.Number(),
});

export const GetVotesForRoundQuerystringSchema = Type.Object({
  gameId: Type.Number(),
  round: Type.Number(),
  phase: Type.String(),
});

export const PlayerVoteSchema = Type.Object({
  voterIndex: Type.Number(),
  encryptedVoteHex: Type.String(),
  merklePathJson: Type.String(),
});

export const GetVotesForRoundResponseSchema = Type.Object({
  votes: Type.Array(PlayerVoteSchema),
});
