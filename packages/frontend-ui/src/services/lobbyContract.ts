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

/**
 * Derives a deterministic bytes32 identifier from the player's Midnight
 * shielded address by SHA-256 hashing the address string.
 *
 * This is the primary identifier used when a Midnight wallet (e.g. Lace) is
 * connected and provides a real shielded address.
 */
export async function hashShieldedAddress(
  shieldedAddress: string,
): Promise<`0x${string}`> {
  const encoder = new TextEncoder()
  const data = encoder.encode(shieldedAddress)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}

/**
 * Fallback: derives a deterministic bytes32 value from the player's EVM
 * address using SHA-256. Used only when no Midnight wallet is connected.
 *
 * @deprecated Prefer hashShieldedAddress() once Midnight wallet is available.
 */
export async function deriveMidnightAddressHash(
  evmAddress: `0x${string}`,
): Promise<`0x${string}`> {
  const encoder = new TextEncoder()
  const data = encoder.encode(evmAddress.toLowerCase())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}
