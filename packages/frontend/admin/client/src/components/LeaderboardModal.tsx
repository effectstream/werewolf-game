import { usePolling } from "../hooks/usePolling.ts";

interface LeaderboardEntry {
  evm_address: string;
  total_points: string;
  games_played: number;
  games_won: number;
  rounds_survived: number;
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
}

interface Props {
  onClose: () => void;
}

export function LeaderboardModal({ onClose }: Props) {
  const { data, error, loading } = usePolling<LeaderboardResponse>(
    "/api/leaderboard?limit=50&offset=0",
    10_000,
  );

  const entries = data?.entries ?? [];

  return (
    <div className="lb-modal-overlay" onClick={onClose}>
      <div className="lb-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="lb-modal-header">
          <h2 className="lb-modal-title">Leaderboard</h2>
          <button className="lb-modal-close" onClick={onClose}>&times;</button>
        </div>

        {loading && entries.length === 0 && (
          <div className="loading">Loading leaderboard...</div>
        )}
        {error && (
          <div className="error">Failed to load leaderboard: {error}</div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="empty">No entries yet.</div>
        )}

        {entries.length > 0 && (
          <div className="lb-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>EVM Address</th>
                  <th>Points</th>
                  <th>W / P</th>
                  <th>Rounds</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const addr = e.evm_address;
                  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
                  const pts = Number(e.total_points).toLocaleString();
                  return (
                    <tr key={addr}>
                      <td className="lb-rank">{i + 1}</td>
                      <td className="lb-addr" title={addr}>{short}</td>
                      <td className="lb-pts">{pts}</td>
                      <td className="lb-wins">
                        {e.games_won}/{e.games_played}
                      </td>
                      <td>{e.rounds_survived}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
