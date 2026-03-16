import { useGameState } from "../contexts/GameStateContext.tsx";

export function PlayerTable() {
  const { gameState } = useGameState();
  const players = gameState?.players ?? [];

  if (players.length === 0) {
    return <div className="info">No player data (bundles not generated yet)</div>;
  }

  return (
    <div className="player-table">
      <h3>Players</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nickname</th>
            <th>Role</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.playerId} className={p.alive ? "" : "dead"}>
              <td>{p.playerId}</td>
              <td>{p.nickname ?? `Player ${p.playerId}`}</td>
              <td>
                <span className={`role role-${p.role.toLowerCase()}`}>
                  {p.role}
                </span>
              </td>
              <td>{p.alive ? "Alive" : "Dead"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
