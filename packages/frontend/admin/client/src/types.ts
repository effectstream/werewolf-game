export type GameSummary = {
  gameId: number;
  phase: string;
  round: number;
  playerCount: number;
  aliveCount: number;
  werewolfCount: number;
  villagerCount: number;
  finished: boolean;
  winner: "VILLAGERS" | "WEREWOLVES" | "DRAW" | null;
};

export type LobbySummary = {
  gameId: number;
  playerCount: number;
  maxPlayers: number;
  closed: boolean;
  bundlesReady: boolean;
  timeoutBlock?: number | null;
};

export type AdminGamesResponse = {
  currentBlock?: number | null;
  games: GameSummary[];
  lobbies: LobbySummary[];
};

export type PlayerInfo = {
  playerId: number;
  role: string;
  roleId: number;
  alive: boolean;
  nickname?: string;
};

export type VoteStatus = {
  round: number;
  phase: string;
  voteCount: number;
  aliveCount: number;
};

export type GameView = {
  phase: string;
  round: number;
  playerCount: number;
  aliveCount: number;
  werewolfCount: number;
  villagerCount: number;
  finished: boolean;
  winner: "VILLAGERS" | "WEREWOLVES" | "DRAW" | null;
  aliveVector: boolean[];
};

export type AdminGameState = {
  gameId: number;
  gameView: GameView | null;
  players: PlayerInfo[];
  voteStatus: VoteStatus;
  hasSecrets: boolean;
  hasMerkleRoot: boolean;
};

export type DecryptedVote = {
  voterIndex: number;
  target: number;
};

export type AdminDecryptedVotes = {
  gameId: number;
  round: number;
  phase: string;
  rawVoteCount: number;
  decrypted: DecryptedVote[];
  error?: string;
};

export type ChatMessage = {
  id: number;
  from: string;
  text: string;
  isSystem: boolean;
};
