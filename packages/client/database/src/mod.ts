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
  getAdminSignKey,
  getAndIncrementGameId,
  getEncryptedGameSeed,
  getLobby,
  getLobbyPlayers,
  incrementLobbyPlayerCount,
  insertLobbyPlayer,
  markBundlesReady,
  setAdminSignKeyUpdate,
  setLobbyTimeout,
  updateLobbyPlayerEvmAddress,
  updateLobbyPlayerTrackingFields,
  upsertLobby,
} from "./sql/werewolf_lobby.queries.ts";

export {
  getAliveSnapshots,
  getPendingPunishments,
  getRoundState as getWerewolfRoundState,
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
  markLeaderboardProcessed,
  upsertGameView,
} from "./sql/werewolf_game_view.queries.ts";

export {
  getLeaderboard,
  getPlayerDataForGame,
  getRoundsSurvivedForPlayer,
  upsertLeaderboardEntry,
} from "./sql/werewolf_leaderboard.queries.ts";

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
  IGetAdminSignKeyParams,
  IGetAdminSignKeyResult,
  IGetAdminSignKeyQuery,
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
  IMarkBundlesReadyParams,
  IMarkBundlesReadyResult,
  IMarkBundlesReadyQuery,
  ISetAdminSignKeyUpdateParams,
  ISetAdminSignKeyUpdateResult,
  ISetAdminSignKeyUpdateQuery,
  IGetAndIncrementGameIdParams,
  IGetAndIncrementGameIdResult,
  IGetAndIncrementGameIdQuery,
  IUpdateLobbyPlayerTrackingFieldsParams,
  IUpdateLobbyPlayerTrackingFieldsResult,
  IUpdateLobbyPlayerTrackingFieldsQuery,
  IUpdateLobbyPlayerEvmAddressParams,
  IUpdateLobbyPlayerEvmAddressResult,
  IUpdateLobbyPlayerEvmAddressQuery,
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
  IMarkLeaderboardProcessedParams,
  IMarkLeaderboardProcessedResult,
  IMarkLeaderboardProcessedQuery,
} from "./sql/werewolf_game_view.queries.ts";

export type {
  IUpsertLeaderboardEntryParams,
  IUpsertLeaderboardEntryResult,
  IUpsertLeaderboardEntryQuery,
  IGetLeaderboardParams,
  IGetLeaderboardResult,
  IGetLeaderboardQuery,
  IGetPlayerDataForGameParams,
  IGetPlayerDataForGameResult,
  IGetPlayerDataForGameQuery,
  IGetRoundsSurvivedForPlayerParams,
  IGetRoundsSurvivedForPlayerResult,
  IGetRoundsSurvivedForPlayerQuery,
} from "./sql/werewolf_leaderboard.queries.ts";

export { migrationTable } from "./migration-order.ts";
