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
  getGamesByEvmAddress,
  getLobby,
  getLobbyPlayers,
  incrementLobbyPlayerCount,
  insertLobbyPlayer,
  markBundlesReady,
  setAdminSignKeyUpdate,
  setLobbyTimeout,
  updateLobbyPlayerEvmAddress,
  updateLobbyPlayerMidnightAddress,
  updateLobbyPlayerTrackingFields,
  upsertLobby,
  getGamesByMidnightAddress,
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
  IEvmMidnightTableExistsQuery,
  IEvmMidnightTableExistsResult,
  IGetEvmMidnightByTokenIdParams,
  IGetEvmMidnightByTokenIdQuery,
  IGetEvmMidnightByTokenIdResult,
  IGetEvmMidnightParams,
  IGetEvmMidnightQuery,
  IGetEvmMidnightResult,
  IInsertEvmMidnightParams,
  IInsertEvmMidnightPropertyParams,
  IInsertEvmMidnightPropertyQuery,
  IInsertEvmMidnightPropertyResult,
  IInsertEvmMidnightQuery,
  IInsertEvmMidnightResult,
} from "./sql/sm_example.queries.ts";

export type {
  ICloseLobbyParams,
  ICloseLobbyQuery,
  ICloseLobbyResult,
  IGetAdminSignKeyParams,
  IGetAdminSignKeyQuery,
  IGetAdminSignKeyResult,
  IGetAndIncrementGameIdParams,
  IGetAndIncrementGameIdQuery,
  IGetAndIncrementGameIdResult,
  IGetLobbyParams,
  IGetLobbyPlayersParams,
  IGetLobbyPlayersQuery,
  IGetLobbyPlayersResult,
  IGetLobbyQuery,
  IGetLobbyResult,
  IIncrementLobbyPlayerCountParams,
  IIncrementLobbyPlayerCountQuery,
  IIncrementLobbyPlayerCountResult,
  IInsertLobbyPlayerParams,
  IInsertLobbyPlayerQuery,
  IInsertLobbyPlayerResult,
  IMarkBundlesReadyParams,
  IMarkBundlesReadyQuery,
  IMarkBundlesReadyResult,
  ISetAdminSignKeyUpdateParams,
  ISetAdminSignKeyUpdateQuery,
  ISetAdminSignKeyUpdateResult,
  ISetLobbyTimeoutParams,
  ISetLobbyTimeoutQuery,
  ISetLobbyTimeoutResult,
  IUpdateLobbyPlayerEvmAddressParams,
  IUpdateLobbyPlayerEvmAddressQuery,
  IUpdateLobbyPlayerEvmAddressResult,
  IUpdateLobbyPlayerMidnightAddressParams,
  IUpdateLobbyPlayerMidnightAddressQuery,
  IUpdateLobbyPlayerMidnightAddressResult,
  IUpdateLobbyPlayerTrackingFieldsParams,
  IUpdateLobbyPlayerTrackingFieldsQuery,
  IUpdateLobbyPlayerTrackingFieldsResult,
  IUpsertLobbyParams,
  IUpsertLobbyQuery,
  IUpsertLobbyResult,
} from "./sql/werewolf_lobby.queries.ts";

export type {
  IGetAliveSnapshotsParams,
  IGetAliveSnapshotsQuery,
  IGetAliveSnapshotsResult,
  IGetPendingPunishmentsParams,
  IGetPendingPunishmentsQuery,
  IGetPendingPunishmentsResult,
  IGetRoundStateParams,
  IGetRoundStateQuery,
  IGetRoundStateResult,
  IInsertPendingPunishmentParams,
  IInsertPendingPunishmentQuery,
  IInsertPendingPunishmentResult,
  IMarkPunishmentExecutedParams,
  IMarkPunishmentExecutedQuery,
  IMarkPunishmentExecutedResult,
  IResolveRoundParams,
  IResolveRoundQuery,
  IResolveRoundResult,
  ISetRoundTimeoutParams,
  ISetRoundTimeoutQuery,
  ISetRoundTimeoutResult,
  ISnapshotAlivePlayerParams,
  ISnapshotAlivePlayerQuery,
  ISnapshotAlivePlayerResult,
  IUpdateRoundVoteCountParams,
  IUpdateRoundVoteCountQuery,
  IUpdateRoundVoteCountResult,
  IUpsertRoundStateParams,
  IUpsertRoundStateQuery,
  IUpsertRoundStateResult,
} from "./sql/werewolf_game.queries.ts";

export type {
  IGetGameViewParams,
  IGetGameViewQuery,
  IGetGameViewResult,
  IMarkLeaderboardProcessedParams,
  IMarkLeaderboardProcessedQuery,
  IMarkLeaderboardProcessedResult,
  IUpsertGameViewParams,
  IUpsertGameViewQuery,
  IUpsertGameViewResult,
} from "./sql/werewolf_game_view.queries.ts";

export type {
  IGetLeaderboardParams,
  IGetLeaderboardQuery,
  IGetLeaderboardResult,
  IGetPlayerDataForGameParams,
  IGetPlayerDataForGameQuery,
  IGetPlayerDataForGameResult,
  IGetRoundsSurvivedForPlayerParams,
  IGetRoundsSurvivedForPlayerQuery,
  IGetRoundsSurvivedForPlayerResult,
  IUpsertLeaderboardEntryParams,
  IUpsertLeaderboardEntryQuery,
  IUpsertLeaderboardEntryResult,
} from "./sql/werewolf_leaderboard.queries.ts";

export { migrationTable } from "./migration-order.ts";
