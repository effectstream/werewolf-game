import { useState } from "react";
import { usePolling } from "./hooks/usePolling.ts";
import { GameSelector } from "./components/GameSelector.tsx";
import { GameState } from "./components/GameState.tsx";
import { PlayerTable } from "./components/PlayerTable.tsx";
import { VoteMonitor } from "./components/VoteMonitor.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { GameStateContext } from "./contexts/GameStateContext.tsx";
import type { AdminGameState } from "./types.ts";
import "./App.css";

export default function App() {
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

  const { data: gameState } = usePolling<AdminGameState>(
    selectedGameId != null
      ? `/api/admin/game_state/${selectedGameId}`
      : null,
    3000,
  );

  return (
    <GameStateContext.Provider value={{ gameState, selectedGameId }}>
      <div className="admin-app">
        <header>
          <h1>Werewolf Admin</h1>
        </header>

        <div className="layout">
          <aside className="sidebar">
            <GameSelector
              selectedGameId={selectedGameId}
              onSelect={setSelectedGameId}
            />
          </aside>

          <main className="content">
            {selectedGameId == null ? (
              <div className="placeholder">Select a game from the sidebar</div>
            ) : !gameState ? (
              <div className="loading">Loading game state...</div>
            ) : (
              <div className="panels">
                <GameState />
                <PlayerTable />
                <VoteMonitor />
                <div className="chat-container">
                  <ChatPanel
                    gameId={selectedGameId}
                    channel="general"
                    label="General Chat"
                  />
                  <ChatPanel
                    gameId={selectedGameId}
                    channel="werewolf"
                    label="Werewolf Chat"
                  />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </GameStateContext.Provider>
  );
}
