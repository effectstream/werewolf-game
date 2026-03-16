import { useGameState } from "../contexts/GameStateContext.tsx";
import { GameIdDisplay } from "./GameIdDisplay.tsx";

export function GameState() {
  const { gameState: state } = useGameState();
  if (!state) return null;

  const gv = state.gameView;

  return (
    <div className="game-state">
      <h3>
        Game <GameIdDisplay gameId={state.gameId} />
      </h3>

      {!gv ? (
        <div className="info">Game view not yet available (lobby phase)</div>
      ) : (
        <div className="state-grid">
          <div className="state-item">
            <label>Phase</label>
            <span className={`phase-badge phase-${gv.phase?.toLowerCase()}`}>
              {gv.finished ? "Finished" : gv.phase}
            </span>
          </div>
          <div className="state-item">
            <label>Round</label>
            <span>{gv.round}</span>
          </div>
          <div className="state-item">
            <label>Alive</label>
            <span>
              {gv.aliveCount} / {gv.playerCount}
            </span>
          </div>
          <div className="state-item">
            <label>Werewolves</label>
            <span>{gv.werewolfCount}</span>
          </div>
          <div className="state-item">
            <label>Villagers</label>
            <span>{gv.villagerCount}</span>
          </div>
        </div>
      )}

      {gv && (
        <div className="vote-progress">
          <label>Votes</label>
          <span>
            {state.voteStatus.voteCount} / {state.voteStatus.aliveCount}
            {state.voteStatus.phase && ` (${state.voteStatus.phase})`}
          </span>
        </div>
      )}

      <div className="meta">
        <span>Secrets: {state.hasSecrets ? "yes" : "no"}</span>
        <span>Merkle root: {state.hasMerkleRoot ? "yes" : "no"}</span>
      </div>
    </div>
  );
}
