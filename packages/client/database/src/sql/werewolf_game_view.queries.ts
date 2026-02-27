/** Types generated for queries found in "src/sql/werewolf_game_view.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'UpsertGameView' parameters type */
export interface IUpsertGameViewParams {
  alive_count: number;
  alive_vector: string;
  finished: boolean;
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

const upsertGameViewIR: any = {"usedParamSet":{"game_id":true,"phase":true,"round":true,"player_count":true,"alive_count":true,"werewolf_count":true,"villager_count":true,"alive_vector":true,"finished":true,"werewolf_indices":true,"updated_block":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":190,"b":198}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":201,"b":207}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":210,"b":216}]},{"name":"player_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":219,"b":232}]},{"name":"alive_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":235,"b":247}]},{"name":"werewolf_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":252,"b":267}]},{"name":"villager_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":270,"b":285}]},{"name":"alive_vector","required":true,"transform":{"type":"scalar"},"locs":[{"a":288,"b":301}]},{"name":"finished","required":true,"transform":{"type":"scalar"},"locs":[{"a":306,"b":315}]},{"name":"werewolf_indices","required":true,"transform":{"type":"scalar"},"locs":[{"a":318,"b":335}]},{"name":"updated_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":338,"b":352}]}],"statement":"INSERT INTO werewolf_game_view (\n  game_id, phase, round, player_count, alive_count,\n  werewolf_count, villager_count, alive_vector,\n  finished, werewolf_indices, updated_block\n)\nVALUES (\n  :game_id!, :phase!, :round!, :player_count!, :alive_count!,\n  :werewolf_count!, :villager_count!, :alive_vector!,\n  :finished!, :werewolf_indices!, :updated_block!\n)\nON CONFLICT (game_id) DO UPDATE SET\n  phase            = EXCLUDED.phase,\n  round            = EXCLUDED.round,\n  player_count     = EXCLUDED.player_count,\n  alive_count      = EXCLUDED.alive_count,\n  werewolf_count   = EXCLUDED.werewolf_count,\n  villager_count   = EXCLUDED.villager_count,\n  alive_vector     = EXCLUDED.alive_vector,\n  finished         = EXCLUDED.finished,\n  werewolf_indices = EXCLUDED.werewolf_indices,\n  updated_block    = EXCLUDED.updated_block"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_game_view (
 *   game_id, phase, round, player_count, alive_count,
 *   werewolf_count, villager_count, alive_vector,
 *   finished, werewolf_indices, updated_block
 * )
 * VALUES (
 *   :game_id!, :phase!, :round!, :player_count!, :alive_count!,
 *   :werewolf_count!, :villager_count!, :alive_vector!,
 *   :finished!, :werewolf_indices!, :updated_block!
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
  game_id: string;
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

const getGameViewIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":44,"b":52}]}],"statement":"SELECT * FROM werewolf_game_view\nWHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT * FROM werewolf_game_view
 * WHERE game_id = :game_id!
 * ```
 */
export const getGameView = new PreparedQuery<IGetGameViewParams,IGetGameViewResult>(getGameViewIR);
