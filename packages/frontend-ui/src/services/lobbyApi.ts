// Read-only backend queries. The API server lives in packages/client/node.
// Set VITE_API_URL in a .env file to override (e.g. http://localhost:9999).
import nacl from 'tweetnacl'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:9999";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface GameStateResponse {
  id: number;
  state: "Open" | "Closed";
  playerCount: number;
  maxPlayers: number;
}

export interface PlayerInfo {
  evmAddress?: string;
  publicKey: string;
  nickname: string;
  playerId?: number;
  appearanceCode: number;
}

export interface GamePlayersResponse {
  gameId: number;
  players: PlayerInfo[];
}

export async function fetchGameState(
  gameId: number,
): Promise<GameStateResponse> {
  const res = await fetch(`${API_BASE}/api/game_state?gameId=${gameId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch game state: ${res.status} ${text}`);
  }
  return res.json() as Promise<GameStateResponse>;
}

export async function fetchGamePlayers(
  gameId: number,
): Promise<GamePlayersResponse> {
  const res = await fetch(`${API_BASE}/api/game_players?gameId=${gameId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch game players: ${res.status} ${text}`);
  }
  return res.json() as Promise<GamePlayersResponse>;
}

export interface PlayerStatus {
  index: number;
  alive: boolean;
}

export interface GameViewResponse {
  gameId: number;
  phase: string;
  round: number;
  playerCount: number;
  aliveCount: number;
  werewolfCount: number;
  villagerCount: number;
  players: PlayerStatus[];
  finished: boolean;
  winner: 'VILLAGERS' | 'WEREWOLVES' | null;
  werewolfIndices: number[];
  updatedBlock: number;
}

type PlayerBundle = {
  gameId: string;
  playerId: number;
  leafSecret: string;
  merklePath: { sibling: { field: string }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
};

export async function fetchGameView(gameId: number): Promise<GameViewResponse> {
  const res = await fetch(`${API_BASE}/api/game_view?gameId=${gameId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch game view: ${res.status} ${text}`);
  }
  const data = await res.json();
  console.log("[lobbyApi] fetchGameView result", data);
  return data as GameViewResponse;
}

export interface VoteStatusResponse {
  voteCount: number;
  aliveCount: number;
}

export async function fetchVoteStatus(
  gameId: number,
  round: number,
  phase: string,
): Promise<VoteStatusResponse> {
  const res = await fetch(
    `${API_BASE}/api/vote_status?gameId=${gameId}&round=${round}&phase=${
      encodeURIComponent(phase)
    }`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch vote status: ${res.status} ${text}`);
  }
  return res.json() as Promise<VoteStatusResponse>;
}

/**
 * Request the player's bundle from the server using Ed25519 signature authentication.
 * Signs "werewolf:{gameId}:{timestamp}" with the player's Ed25519 secret key.
 */
export async function fetchBundle(
  gameId: number,
  publicKeyHex: string,
  secretKey: Uint8Array,
): Promise<PlayerBundle> {
  console.log('[lobbyApi] fetchBundle: Starting fetch', {
    gameId,
    publicKeyHex,
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const msg = new TextEncoder().encode(`werewolf:${gameId}:${timestamp}`)
  const sig = nacl.sign.detached(msg, secretKey)
  const url =
    `${API_BASE}/api/get_bundle?gameId=${gameId}` +
    `&publicKeyHex=${encodeURIComponent(publicKeyHex)}` +
    `&timestamp=${timestamp}` +
    `&signature=${bytesToHex(sig)}`
  console.log('[lobbyApi] fetchBundle: Request URL', url)
  const res = await fetch(url)
  console.log('[lobbyApi] fetchBundle: Response status', res.status, res.statusText)
  if (!res.ok) {
    const text = await res.text()
    console.error('[lobbyApi] fetchBundle: HTTP error', {
      status: res.status,
      statusText: res.statusText,
      body: text,
    })
    throw new Error(`get_bundle failed: ${res.status} ${text}`)
  }
  const data = await res.json() as { success: boolean; bundle?: PlayerBundle }
  if (!data.bundle) {
    console.error('[lobbyApi] fetchBundle: No bundle in response', data)
    throw new Error('get_bundle: no bundle in response')
  }
  console.log('[lobbyApi] fetchBundle: Bundle received successfully', {
    playerId: data.bundle.playerId,
    role: data.bundle.role,
    roleLabel: data.bundle.role === 1 ? 'Werewolf' : data.bundle.role === 0 ? 'Villager' : `unknown(${data.bundle.role})`,
    leafSecret: data.bundle.leafSecret ? '(present)' : '(missing)',
  })
  return data.bundle
}

export interface PlayerGame {
  gameId:       number
  playerIdx:    number | null
  role:         number | null
  publicKeyHex: string
  nickname:     string
  appearanceCode: number
  closed:       boolean
  bundlesReady: boolean
  phase:        string | null
  round:        number | null
  finished:     boolean
}

export interface PlayerGamesResponse {
  evmAddress: string
  games: PlayerGame[]
}

export async function fetchPlayerGames(evmAddress: string): Promise<PlayerGamesResponse> {
  const res = await fetch(
    `${API_BASE}/api/player_games?evmAddress=${encodeURIComponent(evmAddress)}`,
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`player_games failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<PlayerGamesResponse>
}

export interface LobbyStatusResponse {
  state: 'open' | 'closed' | 'bundles_ready'
  playerCount: number
  maxPlayers: number
  bundlesReady: boolean
  finished: boolean
  timeoutBlock?: number
  currentBlock?: number | null
}

export interface OpenLobbyResponse {
  gameId: number;
  playerCount: number;
  maxPlayers: number;
}

export async function fetchOpenLobby(): Promise<OpenLobbyResponse | null> {
  const res = await fetch(`${API_BASE}/api/open_lobby`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`open_lobby failed: ${res.status}`);
  return res.json() as Promise<OpenLobbyResponse>;
}

/**
 * Poll the lobby status to check if bundles are ready.
 */
export async function fetchLobbyStatus(
  gameId: number,
): Promise<LobbyStatusResponse> {
  const res = await fetch(`${API_BASE}/api/lobby_status?gameId=${gameId}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`lobby_status failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<LobbyStatusResponse>
}
