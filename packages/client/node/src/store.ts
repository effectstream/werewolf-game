/**
 * In-memory store for sensitive game data that must not be persisted to the
 * database (which is auto-exposed by the effectstream SDK).
 *
 * - Player bundles: keyed by (gameId, publicKeyHex) after lobby close.
 *   Players retrieve their bundle via Ed25519 signature authentication.
 * - Player public keys: Ed25519 public key bytes for signature verification,
 *   keyed by (gameId, publicKeyHex).
 * - Game secrets: master secret and admin keypairs generated during bundle
 *   creation. Needed for vote decryption and game management.
 * - Phase votes: encrypted votes for the current round/phase. Purged when the
 *   state machine detects a phase transition on-chain.
 * - Admin signing keys: Ed25519 public keys stored per game for votes_for_round
 *   signature verification. Cached from the DB (werewolf_lobby.admin_sign_public_key).
 *
 * All data is lost on server restart — this is an accepted trade-off (deferred).
 */
import nacl from "tweetnacl";

// ---------------------------------------------------------------------------
// Types (mirror the PlayerBundle type in bundle-generator.ts)
// ---------------------------------------------------------------------------

export type PlayerBundle = {
  gameId: string;
  playerId: number;
  leafSecret: string; // 32-byte hex (64 chars) — used as Ed25519 seed for auth
  merklePath: { sibling: { field: string }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
};

export type PhaseVote = {
  voterIndex: number;
  encryptedVoteHex: string;
  merklePathJson: string;
};

export type GameSecrets = {
  masterSecret: Uint8Array;
  /** ZK admin secret — proves game creator authority via witness (never disclosed on-chain). */
  adminSecret: Uint8Array;
  adminVoteKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  adminSignKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  /**
   * Hex seed used to build the admin wallet facade for delegated balancing.
   * No longer used for on-chain authorization (replaced by adminSecret ZK proof).
   *
   * Optional because it is not available until after createMidnightGame returns.
   * lobby-closer.ts updates GameSecrets with the seed once createGame succeeds.
   */
  adminWalletSeed?: string;
  /**
   * The 32-byte game seed decrypted from the on-chain encrypted blob using
   * WEREWOLF_KEY_SECRET. Stored here for future deterministic key derivation —
   * any admin keypair can be re-derived from this seed if the node restarts.
   *
   * Optional: absent if the node was started before the encrypted seed feature
   * was deployed, or if decryption failed.
   */
  gameSeed?: Uint8Array;
};

// ---------------------------------------------------------------------------
// Internal Maps
// ---------------------------------------------------------------------------

/** Bundles keyed by `${gameId}:${publicKeyHex}`. Populated after lobby close. */
const bundlesByPublicKey = new Map<string, PlayerBundle>();

/** Player Ed25519 public key bytes, keyed by `${gameId}:${publicKeyHex}`. */
const playerPublicKeys = new Map<string, Uint8Array>();

/** Game-level secrets (master secret, admin keypairs). */
const gameSecrets = new Map<number, GameSecrets>();

/** Phase votes, keyed by `${gameId}:${round}:${phase}`. */
const phaseVotes = new Map<string, PhaseVote[]>();

/** Admin Ed25519 signing public keys, keyed by gameId (in-memory cache of DB value). */
const adminSignKeys = new Map<number, Uint8Array>();

/** Merkle roots per game (needed by resolveNightPhase). */
const merkleRoots = new Map<number, { field: bigint }>();

/** Decrypted votes cache for player-delegated voting path, keyed by `${gameId}:${round}:${phase}`. */
export type CachedDecryptedVote = { voterIndex: number; target: number; round: number };
const decryptedVotesCache = new Map<string, CachedDecryptedVote[]>();

/** Normalised game-view row — same shape as werewolf_game_view but with number types. */
export type CachedGameView = {
  game_id: number;
  phase: string;
  round: number;
  player_count: number;
  alive_count: number;
  werewolf_count: number;
  villager_count: number;
  alive_vector: string;    // JSON-encoded boolean[]
  finished: boolean;
  werewolf_indices: string; // JSON-encoded number[]
  updated_block: number;
};

/** Write-through cache of werewolf_game_view, keyed by game_id. */
const gameViewCache = new Map<number, CachedGameView>();

/** Normalised werewolf_round_state row — number types instead of pgtyped strings. */
export type CachedRoundState = {
  game_id: number;
  round: number;
  phase: string;
  alive_count: number;
  votes_submitted: number;
  timeout_block: number | null;
  resolved: boolean;
  timed_out: boolean;
  round_started_block: number;
};

/** Write-through cache of werewolf_round_state, keyed by `${gameId}:${round}:${phase}`. */
const roundStateCache = new Map<string, CachedRoundState>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bundleKey(gameId: number, publicKeyHex: string): string {
  return `${gameId}:${publicKeyHex}`;
}

function voteKey(gameId: number, round: number, phase: string): string {
  return `${gameId}:${round}:${phase}`;
}

// ---------------------------------------------------------------------------
// Bundles (keyed by public key, populated after lobby close)
// ---------------------------------------------------------------------------

/**
 * Store bundles mapped by player public key after bundle generation.
 * The map keys are the Ed25519 public key hex strings that players
 * registered with on the EVM contract.
 */
export function storeBundlesByPublicKey(
  gameId: number,
  bundles: Map<string, PlayerBundle>,
): void {
  for (const [publicKeyHex, bundle] of bundles) {
    bundlesByPublicKey.set(bundleKey(gameId, publicKeyHex), bundle);
  }
  console.log(
    `[store] Stored ${bundles.size} bundles by public key for game=${gameId}`,
  );
}

/** Retrieve a bundle assigned to a specific public key. */
export function getBundleByPublicKey(
  gameId: number,
  publicKeyHex: string,
): PlayerBundle | undefined {
  return bundlesByPublicKey.get(bundleKey(gameId, publicKeyHex));
}

// ---------------------------------------------------------------------------
// Player Public Keys (for signature verification)
// ---------------------------------------------------------------------------

/** Store a player's Ed25519 public key bytes for later signature verification. */
export function storePlayerPublicKey(
  gameId: number,
  publicKeyHex: string,
): void {
  const keyBytes = hexToBytes(publicKeyHex);
  if (keyBytes.length !== 32) {
    throw new Error(
      `[store] Public key must be 32 bytes (got ${keyBytes.length}) for game=${gameId}`,
    );
  }
  playerPublicKeys.set(bundleKey(gameId, publicKeyHex), keyBytes);
}

/** Retrieve a player's Ed25519 public key bytes. */
export function getPlayerPublicKey(
  gameId: number,
  publicKeyHex: string,
): Uint8Array | undefined {
  return playerPublicKeys.get(bundleKey(gameId, publicKeyHex));
}

// ---------------------------------------------------------------------------
// Game Secrets
// ---------------------------------------------------------------------------

/** Store game-level secrets generated during bundle creation. */
export function storeGameSecrets(
  gameId: number,
  secrets: GameSecrets,
): void {
  gameSecrets.set(gameId, secrets);
  console.log(`[store] Stored game secrets for game=${gameId}`);
}

/** Retrieve game-level secrets. */
export function getGameSecrets(gameId: number): GameSecrets | undefined {
  return gameSecrets.get(gameId);
}

// ---------------------------------------------------------------------------
// Phase Votes
// ---------------------------------------------------------------------------

/**
 * Record a vote. Returns false if this voterIndex already has a vote
 * for this round/phase (deduplication — same semantics as the old UNIQUE
 * constraint on werewolf_player_votes).
 */
export function addVote(
  gameId: number,
  round: number,
  phase: string,
  vote: PhaseVote,
): boolean {
  const key = voteKey(gameId, round, phase);
  const votes = phaseVotes.get(key) ?? [];
  if (votes.some((v) => v.voterIndex === vote.voterIndex)) {
    return false; // duplicate
  }
  votes.push(vote);
  phaseVotes.set(key, votes);
  return true;
}

/** All votes recorded for a specific round/phase of a game. */
export function getVotes(
  gameId: number,
  round: number,
  phase: string,
): PhaseVote[] {
  return phaseVotes.get(voteKey(gameId, round, phase)) ?? [];
}

/** Vote count for a specific round/phase. */
export function countVotes(
  gameId: number,
  round: number,
  phase: string,
): number {
  return getVotes(gameId, round, phase).length;
}

/**
 * Remove all votes for a round/phase. Called by the state machine after
 * detecting that the on-chain state has advanced past this phase.
 */
export function purgeVotes(
  gameId: number,
  round: number,
  phase: string,
): void {
  const key = voteKey(gameId, round, phase);
  const count = phaseVotes.get(key)?.length ?? 0;
  phaseVotes.delete(key);
  console.log(
    `[store] Purged ${count} votes for game=${gameId} round=${round} phase=${phase}`,
  );
}

// ---------------------------------------------------------------------------
// Decrypted Votes Cache (player-delegated voting path)
// ---------------------------------------------------------------------------

/**
 * Cache decrypted votes resolved from the on-chain ledger.
 * Used so the admin UI can display votes even when players submitted directly.
 */
export function setDecryptedVotes(
  gameId: number,
  round: number,
  phase: string,
  votes: CachedDecryptedVote[],
): void {
  decryptedVotesCache.set(voteKey(gameId, round, phase), votes);
}

/** Retrieve cached decrypted votes (ledger path). Returns [] if not cached. */
export function getCachedDecryptedVotes(
  gameId: number,
  round: number,
  phase: string,
): CachedDecryptedVote[] {
  return decryptedVotesCache.get(voteKey(gameId, round, phase)) ?? [];
}

// ---------------------------------------------------------------------------
// Admin Signing Keys
// ---------------------------------------------------------------------------

/** Cache an admin Ed25519 public key (hex-encoded) for a game. */
export function setAdminSignKey(gameId: number, hexKey: string): void {
  adminSignKeys.set(gameId, hexToBytes(hexKey));
}

/** Retrieve the cached admin signing public key, or undefined on cache miss. */
export function getAdminSignKey(gameId: number): Uint8Array | undefined {
  return adminSignKeys.get(gameId);
}

// ---------------------------------------------------------------------------
// Merkle Roots
// ---------------------------------------------------------------------------

/** Store the Merkle root for a game (needed by resolveNightPhase). */
export function storeMerkleRoot(
  gameId: number,
  root: { field: bigint },
): void {
  merkleRoots.set(gameId, root);
  console.log(`[store] Stored Merkle root for game=${gameId}`);
}

/** Retrieve the Merkle root for a game. */
export function getMerkleRoot(gameId: number): { field: bigint } | undefined {
  return merkleRoots.get(gameId);
}

// ---------------------------------------------------------------------------
// Bundle Enumeration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase Resolution Guard
// ---------------------------------------------------------------------------

/**
 * Tracks which (gameId, round, phase) tuples have already had a contract
 * resolution call dispatched.  Prevents double-calling resolveNightPhase /
 * resolveDayPhase when both the early-resolution path (all votes in) and the
 * timeout path fire for the same round.  Lost on server restart — the DB
 * `resolved` flag is the durable guard; this is the in-process fast path.
 */
const _resolutionTriggered = new Set<string>();

function resolutionKey(gameId: number, round: number, phase: string): string {
  return `${gameId}:${round}:${phase.toUpperCase()}`;
}

export function setResolutionTriggered(
  gameId: number,
  round: number,
  phase: string,
): void {
  _resolutionTriggered.add(resolutionKey(gameId, round, phase));
}

export function isResolutionTriggered(
  gameId: number,
  round: number,
  phase: string,
): boolean {
  return _resolutionTriggered.has(resolutionKey(gameId, round, phase));
}

/**
 * Release the in-progress guard so a failed resolution can be retried.
 *
 * The Set semantically means "resolution is in-progress" — set when the
 * async resolution starts, cleared on failure. The DB `resolved` flag is the
 * durable "completed" marker (set by resolvePhaseFromLedger on success).
 */
export function clearResolutionTriggered(
  gameId: number,
  round: number,
  phase: string,
): void {
  _resolutionTriggered.delete(resolutionKey(gameId, round, phase));
}

// ---------------------------------------------------------------------------
// Unrecoverable-game negative cache
// ---------------------------------------------------------------------------

/**
 * Games for which secret recovery is permanently impossible — no players /
 * no seed in the DB, or already finished (typically on-chain games left over
 * after a DB wipe). The state machine sees these in the Midnight ledger every
 * block and would otherwise re-trigger `restoreGameSecrets` on each cycle,
 * spamming the DB (getGameView / getLobbyPlayers) for a result that can never
 * change. Marking them here stops the retry storm. Lost on restart — which is
 * correct: a restart re-attempts each once and re-marks the still-broken ones.
 */
const unrecoverableGames = new Set<number>();

/** Mark a game as permanently unrecoverable (data missing/finished). */
export function markGameUnrecoverable(gameId: number): void {
  unrecoverableGames.add(gameId);
}

/** True if recovery for this game has been determined permanently impossible. */
export function isGameUnrecoverable(gameId: number): boolean {
  return unrecoverableGames.has(gameId);
}

// ---------------------------------------------------------------------------
// Finished + leaderboard-processed skip set
// ---------------------------------------------------------------------------

/**
 * Finished games whose leaderboard has been persisted. Their on-chain state is
 * terminal and their game_view row is final, so there is nothing left to do —
 * yet they remain in the contract's insert-only `games` map and the state
 * machine would otherwise re-`upsertGameView` + re-query them every block,
 * forever. Since *every* game eventually finishes, this set is what keeps
 * per-block work bounded to live games as the game count grows.
 *
 * Deliberately NOT cleared by clearGameMemory (which runs on the same block we
 * mark a game done) — clearing it would re-admit the game to per-block
 * processing and loop. Lost on restart: each finished game is processed once
 * post-restart, re-confirmed leaderboard-done, and re-marked.
 */
const leaderboardDoneGames = new Set<number>();

/** Mark a finished game as fully processed (leaderboard persisted) → skippable. */
export function markLeaderboardDone(gameId: number): void {
  leaderboardDoneGames.add(gameId);
}

/** True if this finished game's leaderboard is done and it needs no more work. */
export function isLeaderboardDone(gameId: number): boolean {
  return leaderboardDoneGames.has(gameId);
}

// ---------------------------------------------------------------------------
// Bundle Enumeration
// ---------------------------------------------------------------------------

/** Retrieve all bundles for a game (for vote decryption). */
export function getAllBundlesForGame(gameId: number): PlayerBundle[] {
  const prefix = `${gameId}:`;
  const bundles: PlayerBundle[] = [];
  for (const [key, bundle] of bundlesByPublicKey) {
    if (key.startsWith(prefix)) bundles.push(bundle);
  }
  return bundles;
}

// ---------------------------------------------------------------------------
// Game Memory Cleanup
// ---------------------------------------------------------------------------

/**
 * Release all in-memory data for a completed game.
 * Safe to call once the game is finished and the leaderboard has been persisted.
 * After this call, the state machine will fall back to DB-stored values for any
 * remaining STF cycles on the finished game.
 */
export function clearGameMemory(gameId: number): void {
  // Fast path: nothing to clear for this game
  if (
    !gameSecrets.has(gameId) &&
    !merkleRoots.has(gameId) &&
    !adminSignKeys.has(gameId)
  ) {
    return;
  }

  const prefix = `${gameId}:`;

  // Prefix-keyed maps
  for (const key of bundlesByPublicKey.keys()) {
    if (key.startsWith(prefix)) bundlesByPublicKey.delete(key);
  }
  for (const key of playerPublicKeys.keys()) {
    if (key.startsWith(prefix)) playerPublicKeys.delete(key);
  }
  for (const key of phaseVotes.keys()) {
    if (key.startsWith(prefix)) phaseVotes.delete(key);
  }
  for (const key of decryptedVotesCache.keys()) {
    if (key.startsWith(prefix)) decryptedVotesCache.delete(key);
  }
  for (const key of roundStateCache.keys()) {
    if (key.startsWith(prefix)) roundStateCache.delete(key);
  }
  for (const key of _resolutionTriggered) {
    if (key.startsWith(prefix)) _resolutionTriggered.delete(key);
  }

  // GameId-keyed maps
  gameSecrets.delete(gameId);
  adminSignKeys.delete(gameId);
  merkleRoots.delete(gameId);
  gameViewCache.delete(gameId);
  unrecoverableGames.delete(gameId);

  console.log(`[store] Cleared in-memory data for finished game=${gameId}`);
}

// ---------------------------------------------------------------------------
// Game-view cache (write-through, invalidated by state-machine and lobby-closer)
// ---------------------------------------------------------------------------

export function setGameViewCache(gameId: number, view: CachedGameView): void {
  gameViewCache.set(gameId, view);
}

export function getGameViewCache(gameId: number): CachedGameView | undefined {
  return gameViewCache.get(gameId);
}

// ---------------------------------------------------------------------------
// Round-state cache (write-through, refreshed each block by the state machine)
// ---------------------------------------------------------------------------

/** Replace the cached round-state row outright (new round / authoritative refresh). */
export function setRoundStateCache(state: CachedRoundState): void {
  roundStateCache.set(
    voteKey(state.game_id, state.round, state.phase),
    state,
  );
}

/**
 * Merge a partial update into the cached round-state row. No-op on a cache
 * miss — the next state-machine block refreshes the full row from the DB, so a
 * patch before the row is seeded would only cache an incomplete row.
 */
export function patchRoundStateCache(
  gameId: number,
  round: number,
  phase: string,
  patch: Partial<Omit<CachedRoundState, "game_id" | "round" | "phase">>,
): void {
  const key = voteKey(gameId, round, phase);
  const existing = roundStateCache.get(key);
  if (existing === undefined) return;
  roundStateCache.set(key, { ...existing, ...patch });
}

export function getRoundStateCache(
  gameId: number,
  round: number,
  phase: string,
): CachedRoundState | undefined {
  return roundStateCache.get(voteKey(gameId, round, phase));
}
