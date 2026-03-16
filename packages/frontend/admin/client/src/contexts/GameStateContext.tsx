import { createContext, useContext } from "react";
import type { AdminGameState } from "../types.ts";

export type GameStateContextValue = {
  gameState: AdminGameState | null;
  selectedGameId: number | null;
};

export const GameStateContext = createContext<GameStateContextValue>({
  gameState: null,
  selectedGameId: null,
});

export function useGameState(): GameStateContextValue {
  return useContext(GameStateContext);
}
