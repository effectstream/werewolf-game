/**
 * Persists per-game session data to localStorage so a player can rejoin after
 * a page refresh without losing their bundle.
 *
 * The Ed25519 keypair is NO LONGER stored here — it is derived deterministically
 * at runtime by signing `"werewolf:{gameId}"` with the player's EVM wallet
 * (see `deriveGameKeypair` in LobbyScreen.ts).
 *
 * Key format: "werewolf:session:{gameId}"
 */

const PREFIX = 'werewolf:session:'

// Mirrors the PlayerBundle shape used throughout the frontend.
export interface StoredBundle {
  gameId: string
  playerId: number
  leafSecret: string
  merklePath: { sibling: { field: string }; goes_left: boolean }[]
  adminVotePublicKeyHex: string
  role?: number
}

export interface StoredSession {
  gameId:       number
  publicKeyHex: string
  // secretKeyHex intentionally omitted — re-derived on demand from EVM wallet
  nickname:     string
  evmAddress:   string
  bundle:       StoredBundle | null
}

export function saveSession(s: StoredSession): void {
  try {
    localStorage.setItem(PREFIX + s.gameId, JSON.stringify(s))
  } catch {
    // Ignore — storage may be full or disabled (private browsing on some browsers)
  }
}

export function loadSession(gameId: number): StoredSession | null {
  try {
    const raw = localStorage.getItem(PREFIX + gameId)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

export function clearSession(gameId: number): void {
  try {
    localStorage.removeItem(PREFIX + gameId)
  } catch {
    // Ignore
  }
}

/** Returns all sessions stored in localStorage for this origin. */
export function getAllSessions(): StoredSession[] {
  const sessions: StoredSession[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PREFIX)) {
        try {
          const raw = localStorage.getItem(key)
          if (raw) sessions.push(JSON.parse(raw) as StoredSession)
        } catch {
          // Corrupted entry — skip
        }
      }
    }
  } catch {
    // localStorage unavailable
  }
  return sessions
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(h: string): Uint8Array {
  const clean = h.startsWith('0x') ? h.slice(2) : h
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
