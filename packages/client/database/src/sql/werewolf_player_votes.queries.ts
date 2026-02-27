/** Types generated for queries found in "src/sql/werewolf_player_votes.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'InsertPlayerVote' parameters type */
export interface IInsertPlayerVoteParams {
  encrypted_vote: string;
  game_id: NumberOrString;
  merkle_path: string;
  phase: string;
  round: number;
  voter_index: number;
}

/** 'InsertPlayerVote' return type */
export type IInsertPlayerVoteResult = void;

/** 'InsertPlayerVote' query type */
export interface IInsertPlayerVoteQuery {
  params: IInsertPlayerVoteParams;
  result: IInsertPlayerVoteResult;
}

const insertPlayerVoteIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true,"voter_index":true,"encrypted_vote":true,"merkle_path":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":108,"b":116}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":119,"b":125}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":128,"b":134}]},{"name":"voter_index","required":true,"transform":{"type":"scalar"},"locs":[{"a":137,"b":149}]},{"name":"encrypted_vote","required":true,"transform":{"type":"scalar"},"locs":[{"a":152,"b":167}]},{"name":"merkle_path","required":true,"transform":{"type":"scalar"},"locs":[{"a":170,"b":182}]}],"statement":"INSERT INTO werewolf_player_votes (game_id, round, phase, voter_index, encrypted_vote, merkle_path)\nVALUES (:game_id!, :round!, :phase!, :voter_index!, :encrypted_vote!, :merkle_path!)\nON CONFLICT (game_id, round, phase, voter_index) DO NOTHING"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_player_votes (game_id, round, phase, voter_index, encrypted_vote, merkle_path)
 * VALUES (:game_id!, :round!, :phase!, :voter_index!, :encrypted_vote!, :merkle_path!)
 * ON CONFLICT (game_id, round, phase, voter_index) DO NOTHING
 * ```
 */
export const insertPlayerVote = new PreparedQuery<IInsertPlayerVoteParams,IInsertPlayerVoteResult>(insertPlayerVoteIR);


/** 'CountVotesForRound' parameters type */
export interface ICountVotesForRoundParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
}

/** 'CountVotesForRound' return type */
export interface ICountVotesForRoundResult {
  vote_count: number | null;
}

/** 'CountVotesForRound' query type */
export interface ICountVotesForRoundQuery {
  params: ICountVotesForRoundParams;
  result: ICountVotesForRoundResult;
}

const countVotesForRoundIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":82,"b":90}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":104,"b":110}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":124,"b":130}]}],"statement":"SELECT COUNT(*)::INTEGER AS vote_count\nFROM werewolf_player_votes\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT COUNT(*)::INTEGER AS vote_count
 * FROM werewolf_player_votes
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
 * ```
 */
export const countVotesForRound = new PreparedQuery<ICountVotesForRoundParams,ICountVotesForRoundResult>(countVotesForRoundIR);


/** 'GetVotesForRound' parameters type */
export interface IGetVotesForRoundParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
}

/** 'GetVotesForRound' return type */
export interface IGetVotesForRoundResult {
  encrypted_vote: string;
  merkle_path: string;
  voter_index: number;
}

/** 'GetVotesForRound' query type */
export interface IGetVotesForRoundQuery {
  params: IGetVotesForRoundParams;
  result: IGetVotesForRoundResult;
}

const getVotesForRoundIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":91,"b":99}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":113,"b":119}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":133,"b":139}]}],"statement":"SELECT voter_index, encrypted_vote, merkle_path\nFROM werewolf_player_votes\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase!\nORDER BY voter_index ASC"};

/**
 * Query generated from SQL:
 * ```
 * SELECT voter_index, encrypted_vote, merkle_path
 * FROM werewolf_player_votes
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
 * ORDER BY voter_index ASC
 * ```
 */
export const getVotesForRound = new PreparedQuery<IGetVotesForRoundParams,IGetVotesForRoundResult>(getVotesForRoundIR);


/** 'HasPlayerVoted' parameters type */
export interface IHasPlayerVotedParams {
  game_id: NumberOrString;
  phase: string;
  round: number;
  voter_index: number;
}

/** 'HasPlayerVoted' return type */
export interface IHasPlayerVotedResult {
  voted: number | null;
}

/** 'HasPlayerVoted' query type */
export interface IHasPlayerVotedQuery {
  params: IHasPlayerVotedParams;
  result: IHasPlayerVotedResult;
}

const hasPlayerVotedIR: any = {"usedParamSet":{"game_id":true,"round":true,"phase":true,"voter_index":true},"params":[{"name":"game_id","required":true,"transform":{"type":"scalar"},"locs":[{"a":77,"b":85}]},{"name":"round","required":true,"transform":{"type":"scalar"},"locs":[{"a":99,"b":105}]},{"name":"phase","required":true,"transform":{"type":"scalar"},"locs":[{"a":119,"b":125}]},{"name":"voter_index","required":true,"transform":{"type":"scalar"},"locs":[{"a":145,"b":157}]}],"statement":"SELECT COUNT(*)::INTEGER AS voted\nFROM werewolf_player_votes\nWHERE game_id = :game_id! AND round = :round! AND phase = :phase! AND voter_index = :voter_index!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT COUNT(*)::INTEGER AS voted
 * FROM werewolf_player_votes
 * WHERE game_id = :game_id! AND round = :round! AND phase = :phase! AND voter_index = :voter_index!
 * ```
 */
export const hasPlayerVoted = new PreparedQuery<IHasPlayerVotedParams,IHasPlayerVotedResult>(hasPlayerVotedIR);


