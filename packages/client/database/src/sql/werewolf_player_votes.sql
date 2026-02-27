/* @name insertPlayerVote */
INSERT INTO werewolf_player_votes (game_id, round, phase, voter_index, encrypted_vote, merkle_path)
VALUES (:game_id!, :round!, :phase!, :voter_index!, :encrypted_vote!, :merkle_path!)
ON CONFLICT (game_id, round, phase, voter_index) DO NOTHING;

/* @name countVotesForRound */
SELECT COUNT(*)::INTEGER AS vote_count
FROM werewolf_player_votes
WHERE game_id = :game_id! AND round = :round! AND phase = :phase!;

/* @name getVotesForRound */
SELECT voter_index, encrypted_vote, merkle_path
FROM werewolf_player_votes
WHERE game_id = :game_id! AND round = :round! AND phase = :phase!
ORDER BY voter_index ASC;

/* @name hasPlayerVoted */
SELECT COUNT(*)::INTEGER AS voted
FROM werewolf_player_votes
WHERE game_id = :game_id! AND round = :round! AND phase = :phase! AND voter_index = :voter_index!;
