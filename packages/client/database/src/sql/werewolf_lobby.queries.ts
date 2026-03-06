/** Types generated for queries found in "src/sql/werewolf_lobby.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'UpsertLobby' parameters type */
export interface IUpsertLobbyParams {
  admin_sign_public_key?: string | null | void;
  created_block: NumberOrString;
  game_id: NumberOrString;
  max_players: NumberOrString;
}

/** 'UpsertLobby' return type */
export type IUpsertLobbyResult = void;

/** 'UpsertLobby' query type */
export interface IUpsertLobbyQuery {
  params: IUpsertLobbyParams;
  result: IUpsertLobbyResult;
}

const upsertLobbyIR: any = {"usedParamSet":{"game_id":true,"max_players":true,"created_block":true,"admin_sign_public_key":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":96,"b":104}]},{"name":"max_players","required":true,"transform":{"type":"scalar"},"locs":[{"a":107,"b":119}]},{"name":"created_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":122,"b":136}]},{"name":"admin_sign_public_key","required":false,"transform":{"type":"scalar"},"locs":[{"a":139,"b":160}]}],"statement":"INSERT INTO werewolf_lobby (game_id, max_players, created_block, admin_sign_public_key)\nVALUES (:game_id!, :max_players!, :created_block!, :admin_sign_public_key)\nON CONFLICT (game_id) DO NOTHING"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_lobby (game_id, max_players, created_block, admin_sign_public_key)
 * VALUES (:game_id!, :max_players!, :created_block!, :admin_sign_public_key)
 * ON CONFLICT (game_id) DO NOTHING
 * ```
 */
export const upsertLobby = new PreparedQuery<IUpsertLobbyParams,IUpsertLobbyResult>(upsertLobbyIR);


/** 'GetAdminSignKey' parameters type */
export interface IGetAdminSignKeyParams {
  game_id: NumberOrString;
}

/** 'GetAdminSignKey' return type */
export interface IGetAdminSignKeyResult {
  admin_sign_public_key: string | null;
}

/** 'GetAdminSignKey' query type */
export interface IGetAdminSignKeyQuery {
  params: IGetAdminSignKeyParams;
  result: IGetAdminSignKeyResult;
}

const getAdminSignKeyIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":65,"b":73}]}],"statement":"SELECT admin_sign_public_key FROM werewolf_lobby WHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT admin_sign_public_key FROM werewolf_lobby WHERE game_id = :game_id!
 * ```
 */
export const getAdminSignKey = new PreparedQuery<IGetAdminSignKeyParams,IGetAdminSignKeyResult>(getAdminSignKeyIR);


/** 'SetAdminSignKeyUpdate' parameters type */
export interface ISetAdminSignKeyUpdateParams {
  admin_sign_public_key: string;
  game_id: NumberOrString;
}

/** 'SetAdminSignKeyUpdate' return type */
export type ISetAdminSignKeyUpdateResult = void;

/** 'SetAdminSignKeyUpdate' query type */
export interface ISetAdminSignKeyUpdateQuery {
  params: ISetAdminSignKeyUpdateParams;
  result: ISetAdminSignKeyUpdateResult;
}

const setAdminSignKeyUpdateIR: any = {"usedParamSet":{"admin_sign_public_key":true,"game_id":true},"params":[{"name":"admin_sign_public_key","required":true,"transform":{"type":"scalar"},"locs":[{"a":50,"b":72}]},{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":90,"b":98}]}],"statement":"UPDATE werewolf_lobby\nSET admin_sign_public_key = :admin_sign_public_key!\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET admin_sign_public_key = :admin_sign_public_key!
 * WHERE game_id = :game_id!
 * ```
 */
export const setAdminSignKeyUpdate = new PreparedQuery<ISetAdminSignKeyUpdateParams,ISetAdminSignKeyUpdateResult>(setAdminSignKeyUpdateIR);


/** 'MarkBundlesReady' parameters type */
export interface IMarkBundlesReadyParams {
  game_id: NumberOrString;
}

/** 'MarkBundlesReady' return type */
export type IMarkBundlesReadyResult = void;

/** 'MarkBundlesReady' query type */
export interface IMarkBundlesReadyQuery {
  params: IMarkBundlesReadyParams;
  result: IMarkBundlesReadyResult;
}

const markBundlesReadyIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":63,"b":71}]}],"statement":"UPDATE werewolf_lobby\nSET bundles_ready = TRUE\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET bundles_ready = TRUE
 * WHERE game_id = :game_id!
 * ```
 */
export const markBundlesReady = new PreparedQuery<IMarkBundlesReadyParams,IMarkBundlesReadyResult>(markBundlesReadyIR);


/** 'GetAndIncrementGameId' parameters type */
export type IGetAndIncrementGameIdParams = void;

/** 'GetAndIncrementGameId' return type */
export interface IGetAndIncrementGameIdResult {
  last_game_id: string;
}

/** 'GetAndIncrementGameId' query type */
export interface IGetAndIncrementGameIdQuery {
  params: IGetAndIncrementGameIdParams;
  result: IGetAndIncrementGameIdResult;
}

const getAndIncrementGameIdIR: any = {"usedParamSet":{},"params":[],"statement":"UPDATE werewolf_lobby_sequence\nSET last_game_id = last_game_id + 1\nWHERE id = 1\nRETURNING last_game_id"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby_sequence
 * SET last_game_id = last_game_id + 1
 * WHERE id = 1
 * RETURNING last_game_id
 * ```
 */
export const getAndIncrementGameId = new PreparedQuery<IGetAndIncrementGameIdParams,IGetAndIncrementGameIdResult>(getAndIncrementGameIdIR);


/** 'GetLobby' parameters type */
export interface IGetLobbyParams {
  game_id: NumberOrString;
}

/** 'GetLobby' return type */
export interface IGetLobbyResult {
  admin_sign_public_key: string | null;
  bundles_ready: boolean;
  closed: boolean;
  created_block: string;
  game_id: string;
  max_players: string;
  player_count: string;
  timeout_block: string | null;
}

/** 'GetLobby' query type */
export interface IGetLobbyQuery {
  params: IGetLobbyParams;
  result: IGetLobbyResult;
}

const getLobbyIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":45,"b":53}]}],"statement":"SELECT * FROM werewolf_lobby WHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT * FROM werewolf_lobby WHERE game_id = :game_id!
 * ```
 */
export const getLobby = new PreparedQuery<IGetLobbyParams,IGetLobbyResult>(getLobbyIR);


/** 'SetLobbyTimeout' parameters type */
export interface ISetLobbyTimeoutParams {
  game_id: NumberOrString;
  timeout_block: NumberOrString;
}

/** 'SetLobbyTimeout' return type */
export type ISetLobbyTimeoutResult = void;

/** 'SetLobbyTimeout' query type */
export interface ISetLobbyTimeoutQuery {
  params: ISetLobbyTimeoutParams;
  result: ISetLobbyTimeoutResult;
}

const setLobbyTimeoutIR: any = {"usedParamSet":{"timeout_block":true,"game_id":true},"params":[{"name":"timeout_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":56}]},{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":74,"b":82}]}],"statement":"UPDATE werewolf_lobby\nSET timeout_block = :timeout_block!\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET timeout_block = :timeout_block!
 * WHERE game_id = :game_id!
 * ```
 */
export const setLobbyTimeout = new PreparedQuery<ISetLobbyTimeoutParams,ISetLobbyTimeoutResult>(setLobbyTimeoutIR);


/** 'IncrementLobbyPlayerCount' parameters type */
export interface IIncrementLobbyPlayerCountParams {
  game_id: NumberOrString;
}

/** 'IncrementLobbyPlayerCount' return type */
export type IIncrementLobbyPlayerCountResult = void;

/** 'IncrementLobbyPlayerCount' query type */
export interface IIncrementLobbyPlayerCountQuery {
  params: IIncrementLobbyPlayerCountParams;
  result: IIncrementLobbyPlayerCountResult;
}

const incrementLobbyPlayerCountIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":74,"b":82}]}],"statement":"UPDATE werewolf_lobby\nSET player_count = player_count + 1\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET player_count = player_count + 1
 * WHERE game_id = :game_id!
 * ```
 */
export const incrementLobbyPlayerCount = new PreparedQuery<IIncrementLobbyPlayerCountParams,IIncrementLobbyPlayerCountResult>(incrementLobbyPlayerCountIR);


/** 'CloseLobby' parameters type */
export interface ICloseLobbyParams {
  game_id: NumberOrString;
}

/** 'CloseLobby' return type */
export type ICloseLobbyResult = void;

/** 'CloseLobby' query type */
export interface ICloseLobbyQuery {
  params: ICloseLobbyParams;
  result: ICloseLobbyResult;
}

const closeLobbyIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":56,"b":64}]}],"statement":"UPDATE werewolf_lobby\nSET closed = TRUE\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET closed = TRUE
 * WHERE game_id = :game_id!
 * ```
 */
export const closeLobby = new PreparedQuery<ICloseLobbyParams,ICloseLobbyResult>(closeLobbyIR);


/** 'InsertLobbyPlayer' parameters type */
export interface IInsertLobbyPlayerParams {
  game_id: NumberOrString;
  joined_block: NumberOrString;
  nickname: string;
  public_key_hex: string;
}

/** 'InsertLobbyPlayer' return type */
export interface IInsertLobbyPlayerResult {
  game_id: string;
}

/** 'InsertLobbyPlayer' query type */
export interface IInsertLobbyPlayerQuery {
  params: IInsertLobbyPlayerParams;
  result: IInsertLobbyPlayerResult;
}

const insertLobbyPlayerIR: any = {"usedParamSet":{"game_id":true,"public_key_hex":true,"nickname":true,"joined_block":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":93,"b":101}]},{"name":"public_key_hex","required":true,"transform":{"type":"scalar"},"locs":[{"a":104,"b":119}]},{"name":"nickname","required":true,"transform":{"type":"scalar"},"locs":[{"a":122,"b":131}]},{"name":"joined_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":134,"b":147}]}],"statement":"INSERT INTO werewolf_lobby_players (game_id, public_key_hex, nickname, joined_block)\nVALUES (:game_id!, :public_key_hex!, :nickname!, :joined_block!)\nON CONFLICT (game_id, public_key_hex) DO NOTHING\nRETURNING game_id"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_lobby_players (game_id, public_key_hex, nickname, joined_block)
 * VALUES (:game_id!, :public_key_hex!, :nickname!, :joined_block!)
 * ON CONFLICT (game_id, public_key_hex) DO NOTHING
 * RETURNING game_id
 * ```
 */
export const insertLobbyPlayer = new PreparedQuery<IInsertLobbyPlayerParams,IInsertLobbyPlayerResult>(insertLobbyPlayerIR);


/** 'GetLobbyPlayers' parameters type */
export interface IGetLobbyPlayersParams {
  game_id: NumberOrString;
}

/** 'GetLobbyPlayers' return type */
export interface IGetLobbyPlayersResult {
  nickname: string;
  public_key_hex: string;
}

/** 'GetLobbyPlayers' query type */
export interface IGetLobbyPlayersQuery {
  params: IGetLobbyPlayersParams;
  result: IGetLobbyPlayersResult;
}

const getLobbyPlayersIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":76,"b":84}]}],"statement":"SELECT public_key_hex, nickname\nFROM werewolf_lobby_players\nWHERE game_id = :game_id!\nORDER BY joined_block ASC"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public_key_hex, nickname
 * FROM werewolf_lobby_players
 * WHERE game_id = :game_id!
 * ORDER BY joined_block ASC
 * ```
 */
export const getLobbyPlayers = new PreparedQuery<IGetLobbyPlayersParams,IGetLobbyPlayersResult>(getLobbyPlayersIR);


