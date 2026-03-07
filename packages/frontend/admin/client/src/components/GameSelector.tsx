import { usePolling } from "../hooks/usePolling.ts";
import type { AdminGamesResponse, GameSummary, LobbySummary } from "../types.ts";

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
  const label = game.finished
    ? game.werewolfCount === 0
      ? "Villagers Win"
      : game.villagerCount === 0
      ? "Werewolves Win"
      : "Finished"
    : game.phase;

  return (
    <button
      className={`game-item ${selected ? "selected" : ""}`}
      onClick={() => onSelect(game.gameId)}
    >
      <span className="game-id">#{game.gameId}</span>
      <span className={`phase-badge phase-${phaseClass}`}>{label}</span>
      <span className="game-info">
        R{game.round} | {game.aliveCount}/{game.playerCount} alive
      </span>
    </button>
  );
}

function LobbyItem({
  lobby,
  selected,
  onSelect,
}: {
  lobby: LobbySummary;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      className={`game-item lobby ${selected ? "selected" : ""}`}
      onClick={() => onSelect(lobby.gameId)}
    >
      <span className="game-id">#{lobby.gameId}</span>
      <span className="phase-badge phase-lobby">
        {lobby.bundlesReady ? "Ready" : lobby.closed ? "Closed" : "Lobby"}
      </span>
      <span className="game-info">
        {lobby.playerCount}/{lobby.maxPlayers} players
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

  const { games, lobbies } = data;

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
