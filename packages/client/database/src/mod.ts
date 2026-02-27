// Export shared types once
export type { NumberOrString } from "./sql/types.ts";

// Export query functions and interfaces (excluding duplicate types)
export {
  evmMidnightTableExists,
  getEvmMidnight,
  getEvmMidnightByTokenId,
  insertEvmMidnight,
  insertEvmMidnightProperty,
} from "./sql/sm_example.queries.ts";

export {
  closeLobby,
  getLobby,
  getLobbyPlayers,
  incrementLobbyPlayerCount,
  insertLobbyPlayer,
  setLobbyTimeout,
  upsertLobby,
} from "./sql/werewolf_lobby.queries.ts";

export {
  getAliveSnapshots,
  getPendingPunishments,
  getRoundState,
  insertPendingPunishment,
  markPunishmentExecuted,
  resolveRound,
  setRoundTimeout,
  snapshotAlivePlayer,
  updateRoundVoteCount,
  upsertRoundState,
} from "./sql/werewolf_game.queries.ts";

export {
  getGameView,
  upsertGameView,
} from "./sql/werewolf_game_view.queries.ts";

// Export all interface types (excluding duplicate NumberOrString type)
export type {
  IEvmMidnightTableExistsParams,
  IEvmMidnightTableExistsResult,
  IEvmMidnightTableExistsQuery,
  IInsertEvmMidnightParams,
  IInsertEvmMidnightResult,
  IInsertEvmMidnightQuery,
  IInsertEvmMidnightPropertyParams,
  IInsertEvmMidnightPropertyResult,
  IInsertEvmMidnightPropertyQuery,
  IGetEvmMidnightByTokenIdParams,
  IGetEvmMidnightByTokenIdResult,
  IGetEvmMidnightByTokenIdQuery,
  IGetEvmMidnightParams,
  IGetEvmMidnightResult,
  IGetEvmMidnightQuery,
} from "./sql/sm_example.queries.ts";

export type {
  IUpsertLobbyParams,
  IUpsertLobbyResult,
  IUpsertLobbyQuery,
  IGetLobbyParams,
  IGetLobbyResult,
  IGetLobbyQuery,
  ISetLobbyTimeoutParams,
  ISetLobbyTimeoutResult,
  ISetLobbyTimeoutQuery,
  IIncrementLobbyPlayerCountParams,
  IIncrementLobbyPlayerCountResult,
  IIncrementLobbyPlayerCountQuery,
  ICloseLobbyParams,
  ICloseLobbyResult,
  ICloseLobbyQuery,
  IInsertLobbyPlayerParams,
  IInsertLobbyPlayerResult,
  IInsertLobbyPlayerQuery,
  IGetLobbyPlayersParams,
  IGetLobbyPlayersResult,
  IGetLobbyPlayersQuery,
} from "./sql/werewolf_lobby.queries.ts";

export type {
  IUpsertRoundStateParams,
  IUpsertRoundStateResult,
  IUpsertRoundStateQuery,
  IGetRoundStateParams,
  IGetRoundStateResult,
  IGetRoundStateQuery,
  IUpdateRoundVoteCountParams,
  IUpdateRoundVoteCountResult,
  IUpdateRoundVoteCountQuery,
  ISetRoundTimeoutParams,
  ISetRoundTimeoutResult,
  ISetRoundTimeoutQuery,
  IResolveRoundParams,
  IResolveRoundResult,
  IResolveRoundQuery,
  ISnapshotAlivePlayerParams,
  ISnapshotAlivePlayerResult,
  ISnapshotAlivePlayerQuery,
  IGetAliveSnapshotsParams,
  IGetAliveSnapshotsResult,
  IGetAliveSnapshotsQuery,
  IInsertPendingPunishmentParams,
  IInsertPendingPunishmentResult,
  IInsertPendingPunishmentQuery,
  IGetPendingPunishmentsParams,
  IGetPendingPunishmentsResult,
  IGetPendingPunishmentsQuery,
  IMarkPunishmentExecutedParams,
  IMarkPunishmentExecutedResult,
  IMarkPunishmentExecutedQuery,
} from "./sql/werewolf_game.queries.ts";

export type {
  IUpsertGameViewParams,
  IUpsertGameViewResult,
  IUpsertGameViewQuery,
  IGetGameViewParams,
  IGetGameViewResult,
  IGetGameViewQuery,
} from "./sql/werewolf_game_view.queries.ts";

export {
  countBundles,
  insertBundle,
  popBundle,
} from "./sql/werewolf_lobby_bundles.queries.ts";

export type {
  ICountBundlesParams,
  ICountBundlesResult,
  ICountBundlesQuery,
  IInsertBundleParams,
  IInsertBundleResult,
  IInsertBundleQuery,
  IPopBundleParams,
  IPopBundleResult,
  IPopBundleQuery,
} from "./sql/werewolf_lobby_bundles.queries.ts";

export {
  countVotesForRound,
  getVotesForRound,
  hasPlayerVoted,
  insertPlayerVote,
} from "./sql/werewolf_player_votes.queries.ts";

export type {
  ICountVotesForRoundParams,
  ICountVotesForRoundQuery,
  ICountVotesForRoundResult,
  IGetVotesForRoundParams,
  IGetVotesForRoundQuery,
  IGetVotesForRoundResult,
  IHasPlayerVotedParams,
  IHasPlayerVotedQuery,
  IHasPlayerVotedResult,
  IInsertPlayerVoteParams,
  IInsertPlayerVoteQuery,
  IInsertPlayerVoteResult,
} from "./sql/werewolf_player_votes.queries.ts";

export { migrationTable } from "./migration-order.ts";
