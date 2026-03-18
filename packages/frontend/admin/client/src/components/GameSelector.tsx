import { usePolling } from "../hooks/usePolling.ts";
import type { AdminGamesResponse, GameSummary, LobbySummary } from "../types.ts";
import { GameIdDisplay } from "./GameIdDisplay.tsx";

/** Format remaining seconds as "M:SS" or "X min left". */
function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return `${m}:${s.toString().padStart(2, "0")} left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

type Props = {
  selectedGameId: number | null;
  onSelect: (gameId: number) => void;
};

function GameItem({
  game,
  selected,
  onSelect,
}: {
  game: GameSummary;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const phaseClass = game.finished ? "finished" : game.phase?.toLowerCase();
  const label = game.winner === "VILLAGERS"
    ? "Villagers Win"
    : game.winner === "WEREWOLVES"
    ? "Werewolves Win"
    : game.winner === "DRAW"
    ? "Draw"
    : game.finished
    ? "Finished"
    : game.phase;

  return (
    <button
      className={`game-item ${selected ? "selected" : ""}`}
      onClick={() => onSelect(game.gameId)}
    >
      <GameIdDisplay gameId={game.gameId} />
      <span className={`phase-badge phase-${phaseClass}`}>{label}</span>
      <span className="game-info">
        R{game.round} | {game.aliveCount}/{game.playerCount} alive
      </span>
    </button>
  );
}

function LobbyItem({
  lobby,
  currentBlock,
  selected,
  onSelect,
}: {
  lobby: LobbySummary;
  currentBlock: number | null | undefined;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const isOpen = !lobby.closed && !lobby.bundlesReady;
  const remainingSeconds =
    isOpen &&
    lobby.timeoutBlock != null &&
    currentBlock != null &&
    lobby.timeoutBlock > currentBlock
      ? Math.max(0, lobby.timeoutBlock - currentBlock)
      : null;
  const countdown =
    remainingSeconds != null ? formatRemainingTime(remainingSeconds) : null;

  return (
    <button
      className={`game-item lobby ${selected ? "selected" : ""}`}
      onClick={() => onSelect(lobby.gameId)}
    >
      <GameIdDisplay gameId={lobby.gameId} />
      <span className="phase-badge phase-lobby">
        {lobby.bundlesReady ? "Ready" : lobby.closed ? "Closed" : "Lobby"}
      </span>
      <span className="game-info">
        {lobby.playerCount}/{lobby.maxPlayers} players
        {countdown != null && (
          <span className="lobby-countdown"> · {countdown}</span>
        )}
      </span>
    </button>
  );
}

function SectionDivider({ label }: { label: string }) {
  return <div className="section-divider">{label}</div>;
}

export function GameSelector({ selectedGameId, onSelect }: Props) {
  const { data, error } = usePolling<AdminGamesResponse>(
    "/api/admin/games",
    5000,
  );

  if (error) return <div className="error">Failed to load games: {error}</div>;
  if (!data) return <div className="loading">Loading games...</div>;

  const { games, lobbies, currentBlock } = data;

  // Exclude lobbies that already have a corresponding game view
  const gameIds = new Set(games.map((g) => g.gameId));
  const standaloneLobbies = lobbies.filter((l) => !gameIds.has(l.gameId));

  // Split games into active (non-finished) and finished
  const activeGames = games
    .filter((g) => !g.finished)
    .sort((a, b) => b.round - a.round || b.gameId - a.gameId);

  const finishedGames = games
    .filter((g) => g.finished)
    .sort((a, b) => b.gameId - a.gameId);

  const hasContent =
    activeGames.length > 0 ||
    standaloneLobbies.length > 0 ||
    finishedGames.length > 0;

  return (
    <div className="game-selector">
      <h3>Games</h3>
      {!hasContent && <div className="empty">No games found</div>}

      <div className="game-list">
        {activeGames.length > 0 && (
          <>
            <SectionDivider label="Active" />
            {activeGames.map((g) => (
              <GameItem
                key={g.gameId}
                game={g}
                selected={selectedGameId === g.gameId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}

        {standaloneLobbies.length > 0 && (
          <>
            <SectionDivider label="Lobbies" />
            {standaloneLobbies.map((l) => (
              <LobbyItem
                key={l.gameId}
                lobby={l}
                currentBlock={currentBlock}
                selected={selectedGameId === l.gameId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}

        {finishedGames.length > 0 && (
          <>
            <SectionDivider label="Finished" />
            {finishedGames.map((g) => (
              <GameItem
                key={g.gameId}
                game={g}
                selected={selectedGameId === g.gameId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
