import { usePolling } from "../hooks/usePolling.ts";
import { useGameState } from "../contexts/GameStateContext.tsx";
import type { AdminDecryptedVotes } from "../types.ts";

export function VoteMonitor() {
  const { gameState, selectedGameId } = useGameState();
  const players = gameState?.players ?? [];
  const round = gameState?.voteStatus.round ?? 0;
  const phase = gameState?.voteStatus.phase ?? "";

  const normalizedPhase = phase?.toUpperCase();
  const shouldPoll =
    selectedGameId != null &&
    (normalizedPhase === "NIGHT" || normalizedPhase === "DAY");

  const { data } = usePolling<AdminDecryptedVotes>(
    shouldPoll
      ? `/api/admin/decrypted_votes/${selectedGameId}/${round}/${normalizedPhase}`
      : null,
    4000,
  );

  if (!shouldPoll) {
    return <div className="info">No active voting phase</div>;
  }

  const playerName = (idx: number) => {
    const p = players.find((pl) => pl.playerId === idx);
    return p?.nickname ?? `Player ${idx}`;
  };

  return (
    <div className="vote-monitor">
      <h3>
        Votes — Round {round} ({normalizedPhase})
      </h3>

      {!data || data.decrypted.length === 0 ? (
        <div className="info">
          {data?.rawVoteCount
            ? `${data.rawVoteCount} encrypted vote(s), awaiting decryption...`
            : "No votes yet"}
          {data?.error && <div className="error">{data.error}</div>}
        </div>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Voter</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {data.decrypted.map((v, i) => (
                <tr key={i}>
                  <td>{playerName(v.voterIndex)}</td>
                  <td>{playerName(v.target)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="tally">
            <h4>Tally</h4>
            {(() => {
              const counts = new Map<number, number>();
              for (const v of data.decrypted) {
                counts.set(v.target, (counts.get(v.target) ?? 0) + 1);
              }
              const sorted = [...counts.entries()].sort(
                (a, b) => b[1] - a[1],
              );
              return (
                <ul>
                  {sorted.map(([target, count]) => (
                    <li key={target}>
                      {playerName(target)}: {count} vote(s)
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
