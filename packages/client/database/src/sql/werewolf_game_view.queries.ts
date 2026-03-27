/** Types generated for queries found in "src/sql/werewolf_game_view.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'UpsertGameView' parameters type */
export interface IUpsertGameViewParams {
  alive_count: number;
  alive_vector: string;
  finished: boolean;
  finished_at: Date | null | undefined;
  game_id: NumberOrString;
  phase: string;
  player_count: number;
  round: number;
  updated_block: NumberOrString;
  villager_count: number;
  werewolf_count: number;
  werewolf_indices: string;
}

/** 'UpsertGameView' return type */
export type IUpsertGameViewResult = void;

/** 'UpsertGameView' query type */
export interface IUpsertGameViewQuery {
  params: IUpsertGameViewParams;
  result: IUpsertGameViewResult;
}

const upsertGameViewIR: any = {"usedParamSet":{"game_id":true,"phase":true,"round":true,"player_count":true,"alive_count":true,"werewolf_count":true,"villager_count":true,"alive_vector":true,"finished":true,"finished_at":true,"werewolf_indices":true,"updated_block":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":203,"b":212}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":214,"b":221}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":223,"b":230}]},{"name":"player_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":232,"b":246}]},{"name":"alive_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":248,"b":261}]},{"name":"werewolf_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":265,"b":281}]},{"name":"villager_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":283,"b":299}]},{"name":"alive_vector","required":true,"transform":{"type":"scalar"},"locs":[{"a":301,"b":315}]},{"name":"finished","required":true,"transform":{"type":"scalar"},"locs":[{"a":319,"b":329}]},{"name":"finished_at","required":false,"transform":{"type":"scalar"},"locs":[{"a":331,"b":343}]},{"name":"werewolf_indices","required":true,"transform":{"type":"scalar"},"locs":[{"a":345,"b":363}]},{"name":"updated_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":365,"b":380}]}],"statement":"INSERT INTO werewolf_game_view (\n  game_id, phase, round, player_count, alive_count,\n  werewolf_count, villager_count, alive_vector,\n  finished, finished_at, werewolf_indices, updated_block\n)\nVALUES (\n  :game_id!, :phase!, :round!, :player_count!, :alive_count!,\n  :werewolf_count!, :villager_count!, :alive_vector!,\n  :finished!, :finished_at, :werewolf_indices!, :updated_block!\n)\nON CONFLICT (game_id) DO UPDATE SET\n  phase            = EXCLUDED.phase,\n  round            = EXCLUDED.round,\n  player_count     = EXCLUDED.player_count,\n  alive_count      = EXCLUDED.alive_count,\n  werewolf_count   = EXCLUDED.werewolf_count,\n  villager_count   = EXCLUDED.villager_count,\n  alive_vector     = EXCLUDED.alive_vector,\n  finished         = EXCLUDED.finished,\n  finished_at      = COALESCE(werewolf_game_view.finished_at, EXCLUDED.finished_at),\n  werewolf_indices = EXCLUDED.werewolf_indices,\n  updated_block    = EXCLUDED.updated_block"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_game_view (
 *   game_id, phase, round, player_count, alive_count,
 *   werewolf_count, villager_count, alive_vector,
 *   finished, finished_at, werewolf_indices, updated_block
 * )
 * VALUES (
 *   :game_id!, :phase!, :round!, :player_count!, :alive_count!,
 *   :werewolf_count!, :villager_count!, :alive_vector!,
 *   :finished!, :finished_at, :werewolf_indices!, :updated_block!
 * )
 * ON CONFLICT (game_id) DO UPDATE SET
 *   phase            = EXCLUDED.phase,
 *   round            = EXCLUDED.round,
 *   player_count     = EXCLUDED.player_count,
 *   alive_count      = EXCLUDED.alive_count,
 *   werewolf_count   = EXCLUDED.werewolf_count,
 *   villager_count   = EXCLUDED.villager_count,
 *   alive_vector     = EXCLUDED.alive_vector,
 *   finished         = EXCLUDED.finished,
 *   finished_at      = COALESCE(werewolf_game_view.finished_at, EXCLUDED.finished_at),
 *   werewolf_indices = EXCLUDED.werewolf_indices,
 *   updated_block    = EXCLUDED.updated_block
 * ```
 */
export const upsertGameView = new PreparedQuery<IUpsertGameViewParams,IUpsertGameViewResult>(upsertGameViewIR);


/** 'GetGameView' parameters type */
export interface IGetGameViewParams {
  game_id: NumberOrString;
}

/** 'GetGameView' return type */
export interface IGetGameViewResult {
  alive_count: number;
  alive_vector: string;
  finished: boolean;
  finished_at: Date | null;
  game_id: string;
  leaderboard_processed: boolean;
  phase: string;
  player_count: number;
  round: number;
  updated_block: string;
  villager_count: number;
  werewolf_count: number;
  werewolf_indices: string;
}

/** 'GetGameView' query type */
export interface IGetGameViewQuery {
  params: IGetGameViewParams;
  result: IGetGameViewResult;
}

const getGameViewIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":49,"b":57}]}],"statement":"SELECT * FROM werewolf_game_view\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT * FROM werewolf_game_view
 * WHERE game_id = :game_id!
 * ```
 */
export const getGameView = new PreparedQuery<IGetGameViewParams,IGetGameViewResult>(getGameViewIR);


/** 'MarkLeaderboardProcessed' parameters type */
export interface IMarkLeaderboardProcessedParams {
  game_id: NumberOrString;
}

/** 'MarkLeaderboardProcessed' return type */
export type IMarkLeaderboardProcessedResult = void;

/** 'MarkLeaderboardProcessed' query type */
export interface IMarkLeaderboardProcessedQuery {
  params: IMarkLeaderboardProcessedParams;
  result: IMarkLeaderboardProcessedResult;
}

const markLeaderboardProcessedIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":75,"b":83}]}],"statement":"UPDATE werewolf_game_view\nSET leaderboard_processed = TRUE\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_game_view
 * SET leaderboard_processed = TRUE
 * WHERE game_id = :game_id!
 * ```
 */
export const markLeaderboardProcessed = new PreparedQuery<IMarkLeaderboardProcessedParams,IMarkLeaderboardProcessedResult>(markLeaderboardProcessedIR);


