/** Types generated for queries found in "src/sql/werewolf_lobby.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

// ---------------------------------------------------------------------------
// upsertLobby
// ---------------------------------------------------------------------------

/** 'UpsertLobby' parameters type */
export interface IUpsertLobbyParams {
  created_block: number;
  game_id: number;
  max_players: number;
}

/** 'UpsertLobby' return type */
export type IUpsertLobbyResult = void;

/** 'UpsertLobby' query type */
export interface IUpsertLobbyQuery {
  params: IUpsertLobbyParams;
  result: IUpsertLobbyResult;
}

const upsertLobbyIR: any = {"usedParamSet":{"game_id":true,"max_players":true,"created_block":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":72,"b":80}]},{"name":"max_players","required":true,"transform":{"type":"scalar"},"locs":[{"a":83,"b":95}]},{"name":"created_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":98,"b":112}]}],"statement":"INSERT INTO werewolf_lobby (game_id, max_players, created_block)\nVALUES (:game_id!, :max_players!, :created_block!)\nON CONFLICT (game_id) DO NOTHING"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_lobby (game_id, max_players, created_block)
 * VALUES (:game_id!, :max_players!, :created_block!)
 * ON CONFLICT (game_id) DO NOTHING
 * ```
 */
export const upsertLobby = new PreparedQuery<IUpsertLobbyParams, IUpsertLobbyResult>(upsertLobbyIR);


// ---------------------------------------------------------------------------
// getLobby
// ---------------------------------------------------------------------------

/** 'GetLobby' parameters type */
export interface IGetLobbyParams {
  game_id: number;
}

/** 'GetLobby' return type */
export interface IGetLobbyResult {
  closed: boolean;
  created_block: number;
  game_id: number;
  max_players: number;
  player_count: number;
  timeout_block: number | null;
}

/** 'GetLobby' query type */
export interface IGetLobbyQuery {
  params: IGetLobbyParams;
  result: IGetLobbyResult;
}

const getLobbyIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":41,"b":49}]}],"statement":"SELECT * FROM werewolf_lobby WHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT * FROM werewolf_lobby WHERE game_id = :game_id!
 * ```
 */
export const getLobby = new PreparedQuery<IGetLobbyParams, IGetLobbyResult>(getLobbyIR);


// ---------------------------------------------------------------------------
// setLobbyTimeout
// ---------------------------------------------------------------------------

/** 'SetLobbyTimeout' parameters type */
export interface ISetLobbyTimeoutParams {
  game_id: number;
  timeout_block: number;
}

/** 'SetLobbyTimeout' return type */
export type ISetLobbyTimeoutResult = void;

/** 'SetLobbyTimeout' query type */
export interface ISetLobbyTimeoutQuery {
  params: ISetLobbyTimeoutParams;
  result: ISetLobbyTimeoutResult;
}

const setLobbyTimeoutIR: any = {"usedParamSet":{"timeout_block":true,"game_id":true},"params":[{"name":"timeout_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":57}]},{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":75,"b":83}]}],"statement":"UPDATE werewolf_lobby\nSET timeout_block = :timeout_block!\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET timeout_block = :timeout_block!
 * WHERE game_id = :game_id!
 * ```
 */
export const setLobbyTimeout = new PreparedQuery<ISetLobbyTimeoutParams, ISetLobbyTimeoutResult>(setLobbyTimeoutIR);


// ---------------------------------------------------------------------------
// incrementLobbyPlayerCount
// ---------------------------------------------------------------------------

/** 'IncrementLobbyPlayerCount' parameters type */
export interface IIncrementLobbyPlayerCountParams {
  game_id: number;
}

/** 'IncrementLobbyPlayerCount' return type */
export type IIncrementLobbyPlayerCountResult = void;

/** 'IncrementLobbyPlayerCount' query type */
export interface IIncrementLobbyPlayerCountQuery {
  params: IIncrementLobbyPlayerCountParams;
  result: IIncrementLobbyPlayerCountResult;
}

const incrementLobbyPlayerCountIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":66,"b":74}]}],"statement":"UPDATE werewolf_lobby\nSET player_count = player_count + 1\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET player_count = player_count + 1
 * WHERE game_id = :game_id!
 * ```
 */
export const incrementLobbyPlayerCount = new PreparedQuery<IIncrementLobbyPlayerCountParams, IIncrementLobbyPlayerCountResult>(incrementLobbyPlayerCountIR);


// ---------------------------------------------------------------------------
// closeLobby
// ---------------------------------------------------------------------------

/** 'CloseLobby' parameters type */
export interface ICloseLobbyParams {
  game_id: number;
}

/** 'CloseLobby' return type */
export type ICloseLobbyResult = void;

/** 'CloseLobby' query type */
export interface ICloseLobbyQuery {
  params: ICloseLobbyParams;
  result: ICloseLobbyResult;
}

const closeLobbyIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":46,"b":54}]}],"statement":"UPDATE werewolf_lobby\nSET closed = TRUE\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_lobby
 * SET closed = TRUE
 * WHERE game_id = :game_id!
 * ```
 */
export const closeLobby = new PreparedQuery<ICloseLobbyParams, ICloseLobbyResult>(closeLobbyIR);


// ---------------------------------------------------------------------------
// insertLobbyPlayer
// ---------------------------------------------------------------------------

/** 'InsertLobbyPlayer' parameters type */
export interface IInsertLobbyPlayerParams {
  game_id: number;
  joined_block: number;
  midnight_address_hash: string;
}

/** 'InsertLobbyPlayer' return type */
export type IInsertLobbyPlayerResult = void;

/** 'InsertLobbyPlayer' query type */
export interface IInsertLobbyPlayerQuery {
  params: IInsertLobbyPlayerParams;
  result: IInsertLobbyPlayerResult;
}

const insertLobbyPlayerIR: any = {"usedParamSet":{"game_id":true,"midnight_address_hash":true,"joined_block":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":85,"b":93}]},{"name":"midnight_address_hash","required":true,"transform":{"type":"scalar"},"locs":[{"a":96,"b":118}]},{"name":"joined_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":121,"b":134}]}],"statement":"INSERT INTO werewolf_lobby_players (game_id, midnight_address_hash, joined_block)\nVALUES (:game_id!, :midnight_address_hash!, :joined_block!)\nON CONFLICT (game_id, midnight_address_hash) DO NOTHING"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_lobby_players (game_id, midnight_address_hash, joined_block)
 * VALUES (:game_id!, :midnight_address_hash!, :joined_block!)
 * ON CONFLICT (game_id, midnight_address_hash) DO NOTHING
 * ```
 */
export const insertLobbyPlayer = new PreparedQuery<IInsertLobbyPlayerParams, IInsertLobbyPlayerResult>(insertLobbyPlayerIR);


// ---------------------------------------------------------------------------
// getLobbyPlayers
// ---------------------------------------------------------------------------

/** 'GetLobbyPlayers' parameters type */
export interface IGetLobbyPlayersParams {
  game_id: number;
}

/** 'GetLobbyPlayers' return type */
export interface IGetLobbyPlayersResult {
  midnight_address_hash: string;
}

/** 'GetLobbyPlayers' query type */
export interface IGetLobbyPlayersQuery {
  params: IGetLobbyPlayersParams;
  result: IGetLobbyPlayersResult;
}

const getLobbyPlayersIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":75,"b":83}]}],"statement":"SELECT midnight_address_hash FROM werewolf_lobby_players\nWHERE game_id = :game_id!\nORDER BY joined_block ASC"};

/**
 * Query generated from SQL:
 * ```
 * SELECT midnight_address_hash FROM werewolf_lobby_players
 * WHERE game_id = :game_id!
 * ORDER BY joined_block ASC
 * ```
 */
export const getLobbyPlayers = new PreparedQuery<IGetLobbyPlayersParams, IGetLobbyPlayersResult>(getLobbyPlayersIR);
