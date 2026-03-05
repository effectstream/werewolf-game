const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:9999'

export interface GameInfo {
  id: number
  state: 'Open' | 'Closed'
  playerCount: number
  maxPlayers: number
}

export async function getGameState(gameId: number): Promise<GameInfo> {
  console.log('[lobbyContract] getGameState called', { gameId })
  const res = await fetch(`${API_BASE}/api/game_state?gameId=${gameId}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Game not found: ${res.status} ${text}`)
  }
  const data = await res.json() as GameInfo
  console.log('[lobbyContract] getGameState result', data)
  return data
}

