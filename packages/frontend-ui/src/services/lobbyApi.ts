// Read-only backend queries. The API server lives in packages/client/node.
// Set VITE_API_URL in a .env file to override (e.g. http://localhost:9999).
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:9999";

export interface GameStateResponse {
  id: number;
  state: "Open" | "Closed";
  playerCount: number;
  maxPlayers: number;
}

export interface PlayerInfo {
  evmAddress: string;
  midnightAddressHash: string;
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

type BundleDataResponse = {
  success: boolean;
  message?: string;
  bundle?: PlayerBundle;
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
