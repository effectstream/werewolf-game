/** Types generated for queries found in "src/sql/werewolf_leaderboard.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'UpsertLeaderboardEntry' parameters type */
export interface IUpsertLeaderboardEntryParams {
  evm_address: string;
  games_played: number;
  games_won: number;
  last_updated_block: NumberOrString;
  rounds_survived: number;
  total_points: NumberOrString;
}

/** 'UpsertLeaderboardEntry' return type */
export type IUpsertLeaderboardEntryResult = void;

/** 'UpsertLeaderboardEntry' query type */
export interface IUpsertLeaderboardEntryQuery {
  params: IUpsertLeaderboardEntryParams;
  result: IUpsertLeaderboardEntryResult;
}

const upsertLeaderboardEntryIR: any = {"usedParamSet":{"evm_address":true,"total_points":true,"games_played":true,"games_won":true,"rounds_survived":true,"last_updated_block":true},"params":[{"name":"evm_address","required":true,"transform":{"type":"scalar"},"locs":[{"a":131,"b":143}]},{"name":"total_points","required":true,"transform":{"type":"scalar"},"locs":[{"a":146,"b":159}]},{"name":"games_played","required":true,"transform":{"type":"scalar"},"locs":[{"a":162,"b":175}]},{"name":"games_won","required":true,"transform":{"type":"scalar"},"locs":[{"a":178,"b":188}]},{"name":"rounds_survived","required":true,"transform":{"type":"scalar"},"locs":[{"a":191,"b":207}]},{"name":"last_updated_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":210,"b":229}]}],"statement":"INSERT INTO werewolf_leaderboard (evm_address, total_points, games_played, games_won, rounds_survived, last_updated_block)\nVALUES (:evm_address!, :total_points!, :games_played!, :games_won!, :rounds_survived!, :last_updated_block!)\nON CONFLICT (evm_address) DO UPDATE SET\n  total_points    = werewolf_leaderboard.total_points    + EXCLUDED.total_points,\n  games_played    = werewolf_leaderboard.games_played    + EXCLUDED.games_played,\n  games_won       = werewolf_leaderboard.games_won       + EXCLUDED.games_won,\n  rounds_survived = werewolf_leaderboard.rounds_survived + EXCLUDED.rounds_survived,\n  last_updated_block = EXCLUDED.last_updated_block"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_leaderboard (evm_address, total_points, games_played, games_won, rounds_survived, last_updated_block)
 * VALUES (:evm_address!, :total_points!, :games_played!, :games_won!, :rounds_survived!, :last_updated_block!)
 * ON CONFLICT (evm_address) DO UPDATE SET
 *   total_points    = werewolf_leaderboard.total_points    + EXCLUDED.total_points,
 *   games_played    = werewolf_leaderboard.games_played    + EXCLUDED.games_played,
 *   games_won       = werewolf_leaderboard.games_won       + EXCLUDED.games_won,
 *   rounds_survived = werewolf_leaderboard.rounds_survived + EXCLUDED.rounds_survived,
 *   last_updated_block = EXCLUDED.last_updated_block
 * ```
 */
export const upsertLeaderboardEntry = new PreparedQuery<IUpsertLeaderboardEntryParams,IUpsertLeaderboardEntryResult>(upsertLeaderboardEntryIR);


/** 'GetLeaderboard' parameters type */
export interface IGetLeaderboardParams {
  limit: NumberOrString;
  offset: NumberOrString;
}

/** 'GetLeaderboard' return type */
export interface IGetLeaderboardResult {
  evm_address: string;
  games_played: number;
  games_won: number;
  rounds_survived: number;
  total_points: string;
}

/** 'GetLeaderboard' query type */
export interface IGetLeaderboardQuery {
  params: IGetLeaderboardParams;
  result: IGetLeaderboardResult;
}

const getLeaderboardIR: any = {"usedParamSet":{"limit":true,"offset":true},"params":[{"name":"limit","required":true,"transform":{"type":"scalar"},"locs":[{"a":134,"b":140}]},{"name":"offset","required":true,"transform":{"type":"scalar"},"locs":[{"a":149,"b":156}]}],"statement":"SELECT evm_address, total_points, games_played, games_won, rounds_survived\nFROM werewolf_leaderboard\nORDER BY total_points DESC\nLIMIT :limit! OFFSET :offset!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT evm_address, total_points, games_played, games_won, rounds_survived
 * FROM werewolf_leaderboard
 * ORDER BY total_points DESC
 * LIMIT :limit! OFFSET :offset!
 * ```
 */
export const getLeaderboard = new PreparedQuery<IGetLeaderboardParams,IGetLeaderboardResult>(getLeaderboardIR);


/** 'GetPlayerDataForGame' parameters type */
export interface IGetPlayerDataForGameParams {
  game_id: NumberOrString;
}

/** 'GetPlayerDataForGame' return type */
export interface IGetPlayerDataForGameResult {
  evm_address: string | null;
  player_idx: number | null;
  public_key_hex: string;
  role: number | null;
}

/** 'GetPlayerDataForGame' query type */
export interface IGetPlayerDataForGameQuery {
  params: IGetPlayerDataForGameParams;
  result: IGetPlayerDataForGameResult;
}

const getPlayerDataForGameIR: any = {"usedParamSet":{"game_id":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":97,"b":105}]}],"statement":"SELECT public_key_hex, evm_address, player_idx, role\nFROM werewolf_lobby_players\nWHERE game_id = :game_id!\n  AND evm_address IS NOT NULL\n  AND player_idx IS NOT NULL\n  AND role IS NOT NULL"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public_key_hex, evm_address, player_idx, role
 * FROM werewolf_lobby_players
 * WHERE game_id = :game_id!
 *   AND evm_address IS NOT NULL
 *   AND player_idx IS NOT NULL
 *   AND role IS NOT NULL
 * ```
 */
export const getPlayerDataForGame = new PreparedQuery<IGetPlayerDataForGameParams,IGetPlayerDataForGameResult>(getPlayerDataForGameIR);


/** 'GetRoundsSurvivedForPlayer' parameters type */
export interface IGetRoundsSurvivedForPlayerParams {
  game_id: NumberOrString;
  player_idx: number;
}

/** 'GetRoundsSurvivedForPlayer' return type */
export interface IGetRoundsSurvivedForPlayerResult {
  rounds_survived: number | null;
}

/** 'GetRoundsSurvivedForPlayer' query type */
export interface IGetRoundsSurvivedForPlayerQuery {
  params: IGetRoundsSurvivedForPlayerParams;
  result: IGetRoundsSurvivedForPlayerResult;
}

const getRoundsSurvivedForPlayerIR: any = {"usedParamSet":{"game_id":true,"player_idx":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":98,"b":106}]},{"name":"player_idx","required":true,"transform":{"type":"scalar"},"locs":[{"a":125,"b":136}]}],"statement":"SELECT COUNT(DISTINCT round)::INT AS rounds_survived\nFROM werewolf_alive_snapshot\nWHERE game_id = :game_id! AND player_idx = :player_idx!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT COUNT(DISTINCT round)::INT AS rounds_survived
 * FROM werewolf_alive_snapshot
 * WHERE game_id = :game_id! AND player_idx = :player_idx!
 * ```
 */
export const getRoundsSurvivedForPlayer = new PreparedQuery<IGetRoundsSurvivedForPlayerParams,IGetRoundsSurvivedForPlayerResult>(getRoundsSurvivedForPlayerIR);


