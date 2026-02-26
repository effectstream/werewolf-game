/** Types generated for queries found in "src/sql/werewolf_game.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'UpsertRoundState' parameters type */
export interface IUpsertRoundStateParams {
  alive_count: number;
  game_id: NumberOrString;
  phase: string;
  round: number;
  round_started_block: NumberOrString;
}

/** 'UpsertRoundState' return type */
export type IUpsertRoundStateResult = void;

/** 'UpsertRoundState' query type */
export interface IUpsertRoundStateQuery {
  params: IUpsertRoundStateParams;
  result: IUpsertRoundStateResult;
}

const upsertRoundStateIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true,"alive_count":true,"round_started_block":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":99,"b":107}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":110,"b":116}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":119,"b":125}]},{"name":"alive_count","required":true,"transform":{"type":"scalar"},"locs":[{"a":128,"b":140}]},{"name":"round_started_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":143,"b":163}]}],"statement":"INSERT INTO werewolf_round_state (game_id, round, phase, alive_count, round_started_block)\nVALUES (:game_id!, :round!, :phase!, :alive_count!, :round_started_block!)\nON CONFLICT (game_id, round, phase) DO NOTHING"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_round_state (game_id, round, phase, alive_count, round_started_block)
 * VALUES (:game_id!, :round!, :phase!, :alive_count!, :round_started_block!)
 * ON CONFLICT (game_id, round, phase) DO NOTHING
 * ```
 */
export const upsertRoundState = new PreparedQuery<IUpsertRoundStateParams,IUpsertRoundStateResult>(upsertRoundStateIR);


/** 'GetRoundState' parameters type */
export interface IGetRoundStateParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
}

/** 'GetRoundState' return type */
export interface IGetRoundStateResult {
  alive_count: number;
  game_id: string;
  phase: string;
  resolved: boolean;
  round: number;
  round_started_block: string;
  timeout_block: string | null;
  votes_submitted: number;
}

/** 'GetRoundState' query type */
export interface IGetRoundStateQuery {
  params: IGetRoundStateParams;
  result: IGetRoundStateResult;
}

const getRoundStateIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":51,"b":59}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":73,"b":79}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":93,"b":99}]}],"statement":"SELECT * FROM werewolf_round_state\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT * FROM werewolf_round_state
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
 * ```
 */
export const getRoundState = new PreparedQuery<IGetRoundStateParams,IGetRoundStateResult>(getRoundStateIR);


/** 'UpdateRoundVoteCount' parameters type */
export interface IUpdateRoundVoteCountParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
  votes_submitted: number;
}

/** 'UpdateRoundVoteCount' return type */
export type IUpdateRoundVoteCountResult = void;

/** 'UpdateRoundVoteCount' query type */
export interface IUpdateRoundVoteCountQuery {
  params: IUpdateRoundVoteCountParams;
  result: IUpdateRoundVoteCountResult;
}

const updateRoundVoteCountIR: any = {"usedParamSet":{"votes_submitted":true,"game_id":true,"round":true,"phase":true},"params":[{"name":"votes_submitted","required":true,"transform":{"type":"scalar"},"locs":[{"a":50,"b":66}]},{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":84,"b":92}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":106,"b":112}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":126,"b":132}]}],"statement":"UPDATE werewolf_round_state\nSET votes_submitted = :votes_submitted!\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_round_state
 * SET votes_submitted = :votes_submitted!
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
 * ```
 */
export const updateRoundVoteCount = new PreparedQuery<IUpdateRoundVoteCountParams,IUpdateRoundVoteCountResult>(updateRoundVoteCountIR);


/** 'SetRoundTimeout' parameters type */
export interface ISetRoundTimeoutParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
  timeout_block: NumberOrString;
}

/** 'SetRoundTimeout' return type */
export type ISetRoundTimeoutResult = void;

/** 'SetRoundTimeout' query type */
export interface ISetRoundTimeoutQuery {
  params: ISetRoundTimeoutParams;
  result: ISetRoundTimeoutResult;
}

const setRoundTimeoutIR: any = {"usedParamSet":{"timeout_block":true,"game_id":true,"round":true,"phase":true},"params":[{"name":"timeout_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":48,"b":62}]},{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":80,"b":88}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":102,"b":108}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":122,"b":128}]}],"statement":"UPDATE werewolf_round_state\nSET timeout_block = :timeout_block!\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_round_state
 * SET timeout_block = :timeout_block!
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
 * ```
 */
export const setRoundTimeout = new PreparedQuery<ISetRoundTimeoutParams,ISetRoundTimeoutResult>(setRoundTimeoutIR);


/** 'ResolveRound' parameters type */
export interface IResolveRoundParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
}

/** 'ResolveRound' return type */
export type IResolveRoundResult = void;

/** 'ResolveRound' query type */
export interface IResolveRoundQuery {
  params: IResolveRoundParams;
  result: IResolveRoundResult;
}

const resolveRoundIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":64,"b":72}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":86,"b":92}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":106,"b":112}]}],"statement":"UPDATE werewolf_round_state\nSET resolved = TRUE\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_round_state
 * SET resolved = TRUE
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
 * ```
 */
export const resolveRound = new PreparedQuery<IResolveRoundParams,IResolveRoundResult>(resolveRoundIR);


/** 'SnapshotAlivePlayer' parameters type */
export interface ISnapshotAlivePlayerParams {
  game_id: NumberOrString;
  phase: string;
  player_idx: number;
  round: number;
}

/** 'SnapshotAlivePlayer' return type */
export type ISnapshotAlivePlayerResult = void;

/** 'SnapshotAlivePlayer' query type */
export interface ISnapshotAlivePlayerQuery {
  params: ISnapshotAlivePlayerParams;
  result: ISnapshotAlivePlayerResult;
}

const snapshotAlivePlayerIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true,"player_idx":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":80,"b":88}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":91,"b":97}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":100,"b":106}]},{"name":"player_idx","required":true,"transform":{"type":"scalar"},"locs":[{"a":109,"b":120}]}],"statement":"INSERT INTO werewolf_alive_snapshot (game_id, round, phase, player_idx)\nVALUES (:game_id!, :round!, :phase!, :player_idx!)\nON CONFLICT (game_id, round, phase, player_idx) DO NOTHING"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_alive_snapshot (game_id, round, phase, player_idx)
 * VALUES (:game_id!, :round!, :phase!, :player_idx!)
 * ON CONFLICT (game_id, round, phase, player_idx) DO NOTHING
 * ```
 */
export const snapshotAlivePlayer = new PreparedQuery<ISnapshotAlivePlayerParams,ISnapshotAlivePlayerResult>(snapshotAlivePlayerIR);


/** 'GetAliveSnapshots' parameters type */
export interface IGetAliveSnapshotsParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
}

/** 'GetAliveSnapshots' return type */
export interface IGetAliveSnapshotsResult {
  player_idx: number;
}

/** 'GetAliveSnapshots' query type */
export interface IGetAliveSnapshotsQuery {
  params: IGetAliveSnapshotsParams;
  result: IGetAliveSnapshotsResult;
}

const getAliveSnapshotsIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":63,"b":71}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":85,"b":91}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":105,"b":111}]}],"statement":"SELECT player_idx FROM werewolf_alive_snapshot\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase!\nORDER BY player_idx ASC"};

/**
 * Query generated from SQL:
 * ```
 * SELECT player_idx FROM werewolf_alive_snapshot
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
 * ORDER BY player_idx ASC
 * ```
 */
export const getAliveSnapshots = new PreparedQuery<IGetAliveSnapshotsParams,IGetAliveSnapshotsResult>(getAliveSnapshotsIR);


/** 'InsertPendingPunishment' parameters type */
export interface IInsertPendingPunishmentParams {
  created_at_block: NumberOrString;
  game_id: NumberOrString;
  player_idx: number;
  reason: string;
}

/** 'InsertPendingPunishment' return type */
export type IInsertPendingPunishmentResult = void;

/** 'InsertPendingPunishment' query type */
export interface IInsertPendingPunishmentQuery {
  params: IInsertPendingPunishmentParams;
  result: IInsertPendingPunishmentResult;
}

const insertPendingPunishmentIR: any = {"usedParamSet":{"game_id":true,"player_idx":true,"reason":true,"created_at_block":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":97,"b":105}]},{"name":"player_idx","required":true,"transform":{"type":"scalar"},"locs":[{"a":108,"b":119}]},{"name":"reason","required":true,"transform":{"type":"scalar"},"locs":[{"a":122,"b":129}]},{"name":"created_at_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":132,"b":149}]}],"statement":"INSERT INTO werewolf_pending_punishments (game_id, player_idx, reason, created_at_block)\nVALUES (:game_id!, :player_idx!, :reason!, :created_at_block!)"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_pending_punishments (game_id, player_idx, reason, created_at_block)
 * VALUES (:game_id!, :player_idx!, :reason!, :created_at_block!)
 * ```
 */
export const insertPendingPunishment = new PreparedQuery<IInsertPendingPunishmentParams,IInsertPendingPunishmentResult>(insertPendingPunishmentIR);


/** 'GetPendingPunishments' parameters type */
export type IGetPendingPunishmentsParams = void;

/** 'GetPendingPunishments' return type */
export interface IGetPendingPunishmentsResult {
  created_at_block: string;
  game_id: string;
  id: number;
  player_idx: number;
  reason: string;
}

/** 'GetPendingPunishments' query type */
export interface IGetPendingPunishmentsQuery {
  params: IGetPendingPunishmentsParams;
  result: IGetPendingPunishmentsResult;
}

const getPendingPunishmentsIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT id, game_id, player_idx, reason, created_at_block\nFROM werewolf_pending_punishments\nWHERE executed = FALSE\nORDER BY created_at_block ASC"};

/**
 * Query generated from SQL:
 * ```
 * SELECT id, game_id, player_idx, reason, created_at_block
 * FROM werewolf_pending_punishments
 * WHERE executed = FALSE
 * ORDER BY created_at_block ASC
 * ```
 */
export const getPendingPunishments = new PreparedQuery<IGetPendingPunishmentsParams,IGetPendingPunishmentsResult>(getPendingPunishmentsIR);


/** 'MarkPunishmentExecuted' parameters type */
export interface IMarkPunishmentExecutedParams {
  id: number;
}

/** 'MarkPunishmentExecuted' return type */
export type IMarkPunishmentExecutedResult = void;

/** 'MarkPunishmentExecuted' query type */
export interface IMarkPunishmentExecutedQuery {
  params: IMarkPunishmentExecutedParams;
  result: IMarkPunishmentExecutedResult;
}

const markPunishmentExecutedIR: any = {"usedParamSet":{"id":true},"params":[{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":67,"b":70}]}],"statement":"UPDATE werewolf_pending_punishments\nSET executed = TRUE\nWHERE id = :id!"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_pending_punishments
 * SET executed = TRUE
 * WHERE id = :id!
 * ```
 */
export const markPunishmentExecuted = new PreparedQuery<IMarkPunishmentExecutedParams,IMarkPunishmentExecutedResult>(markPunishmentExecutedIR);


