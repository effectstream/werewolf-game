/** Types generated for queries found in "src/sql/werewolf_lobby_bundles.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'InsertBundle' parameters type */
export interface IInsertBundleParams {
  bundle: string;
  game_id: NumberOrString;
}

/** 'InsertBundle' return type */
export type IInsertBundleResult = void;

/** 'InsertBundle' query type */
export interface IInsertBundleQuery {
  params: IInsertBundleParams;
  result: IInsertBundleResult;
}

const insertBundleIR: any = {"usedParamSet":{"game_id":true,"bundle":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":61,"b":69}]},{"name":"bundle","required":true,"transform":{"type":"scalar"},"locs":[{"a":72,"b":79}]}],"statement":"INSERT INTO werewolf_lobby_bundles (game_id, bundle)\nVALUES (:game_id!, :bundle!)"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_lobby_bundles (game_id, bundle)
 * VALUES (:game_id!, :bundle!)
 * ```
 */
export const insertBundle = new PreparedQuery<IInsertBundleParams,IInsertBundleResult>(insertBundleIR);


/** 'CountBundles' parameters type */
export interface ICountBundlesParams {
  game_id: NumberOrString;
}

/** 'CountBundles' return type */
export interface ICountBundlesResult {
  remaining: string | null;
}

/** 'CountBundles' query type */
export interface ICountBundlesQuery {
  params: ICountBundlesParams;
  result: ICountBundlesResult;
}

const countBundlesIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":73,"b":81}]}],"statement":"SELECT COUNT(*) AS remaining FROM werewolf_lobby_bundles WHERE game_id = :game_id!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT COUNT(*) AS remaining FROM werewolf_lobby_bundles WHERE game_id = :game_id!
 * ```
 */
export const countBundles = new PreparedQuery<ICountBundlesParams,ICountBundlesResult>(countBundlesIR);


/** 'PopBundle' parameters type */
export interface IPopBundleParams {
  game_id: NumberOrString;
}

/** 'PopBundle' return type */
export interface IPopBundleResult {
  bundle: string;
}

/** 'PopBundle' query type */
export interface IPopBundleQuery {
  params: IPopBundleParams;
  result: IPopBundleResult;
}

const popBundleIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":106,"b":114}]}],"statement":"DELETE FROM werewolf_lobby_bundles\nWHERE id = (\n  SELECT id FROM werewolf_lobby_bundles\n  WHERE game_id = :game_id!\n  ORDER BY id DESC\n  LIMIT 1\n)\nRETURNING bundle"};

/**
 * Query generated from SQL:
 * ```
 * DELETE FROM werewolf_lobby_bundles
 * WHERE id = (
 *   SELECT id FROM werewolf_lobby_bundles
 *   WHERE game_id = :game_id!
 *   ORDER BY id DESC
 *   LIMIT 1
 * )
 * RETURNING bundle
 * ```
 */
export const popBundle = new PreparedQuery<IPopBundleParams,IPopBundleResult>(popBundleIR);


