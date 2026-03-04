/**
 * In-memory store for sensitive game data that must not be persisted to the
 * database (which is auto-exposed by the effectstream SDK).
 *
 * - Pending bundles: pre-shuffled PlayerBundles waiting for first-time delivery.
 * - Delivered bundles: assigned bundles, keyed by (gameId, playerHash). Re-retrieval
 *   requires a signature produced with the Ed25519 key derived from the bundle's leafSecret.
 * - Phase votes: encrypted votes for the current round/phase. Purged when the
 *   state machine detects a phase transition on-chain.
 * - Admin signing keys: Ed25519 public keys stored per game for votes_for_round
 *   signature verification. Cached from the DB (werewolf_lobby.admin_sign_public_key).
 *
 * All data is lost on server restart — this is an accepted trade-off (deferred).
 */
import nacl from "tweetnacl";

// ---------------------------------------------------------------------------
// Types (mirror the PlayerBundle type in werewolfLobby.ts)
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

type DeliveredEntry = {
  bundle: PlayerBundle;
  sigPublicKey: Uint8Array; // Ed25519 public key derived from leafSecret
};

// ---------------------------------------------------------------------------
// Internal Maps
// ---------------------------------------------------------------------------

/** Pending bundles awaiting first-time player pickup. Keyed by gameId. */
const pendingBundles = new Map<number, PlayerBundle[]>();

/** Delivered bundles, keyed by `${gameId}:${playerHash}`. */
const deliveredBundles = new Map<string, DeliveredEntry>();

/** Phase votes, keyed by `${gameId}:${round}:${phase}`. */
const phaseVotes = new Map<string, PhaseVote[]>();

/** Admin Ed25519 signing public keys, keyed by gameId (in-memory cache of DB value). */
const adminSignKeys = new Map<number, Uint8Array>();

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

function deliveredKey(gameId: number, playerHash: string): string {
  return `${gameId}:${playerHash}`;
}

function voteKey(gameId: number, round: number, phase: string): string {
  return `${gameId}:${round}:${phase}`;
}

// ---------------------------------------------------------------------------
// Pending Bundles
// ---------------------------------------------------------------------------

/** Store the full bundle pool for a game on creation. */
export function storePendingBundles(
  gameId: number,
  bundles: PlayerBundle[],
): void {
  pendingBundles.set(gameId, [...bundles]);
  console.log(`[store] Stored ${bundles.length} pending bundles for game=${gameId}`);
}

/** Pop one bundle from the pool (LIFO). Returns undefined when pool is empty. */
export function popPendingBundle(gameId: number): PlayerBundle | undefined {
  const pool = pendingBundles.get(gameId);
  if (!pool || pool.length === 0) return undefined;
  return pool.pop();
}

/** Number of bundles still available in the pool for a game. */
export function countPendingBundles(gameId: number): number {
  return pendingBundles.get(gameId)?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Delivered Bundles
// ---------------------------------------------------------------------------

/**
 * Record a bundle as delivered to a player.
 * Derives the player's Ed25519 signing public key from their leafSecret so
 * that future re-retrieval requests can be authenticated.
 *
 * Requirement: leafSecret must be a 32-byte value encoded as 64 hex chars.
 */
export function storeDeliveredBundle(
  gameId: number,
  playerHash: string,
  bundle: PlayerBundle,
): void {
  const seed = hexToBytes(bundle.leafSecret);
  if (seed.length !== 32) {
    throw new Error(
      `[store] leafSecret for player ${playerHash} in game ${gameId} must be 32 bytes (got ${seed.length})`,
    );
  }
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  deliveredBundles.set(deliveredKey(gameId, playerHash), {
    bundle,
    sigPublicKey: keypair.publicKey,
  });
  console.log(`[store] Stored delivered bundle for game=${gameId} player=${playerHash}`);
}

/** Retrieve a delivered bundle entry (bundle + signing public key). */
export function getDeliveredBundle(
  gameId: number,
  playerHash: string,
): DeliveredEntry | undefined {
  return deliveredBundles.get(deliveredKey(gameId, playerHash));
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
export function countVotes(gameId: number, round: number, phase: string): number {
  return getVotes(gameId, round, phase).length;
}

/**
 * Remove all votes for a round/phase. Called by the state machine after
 * detecting that the on-chain state has advanced past this phase.
 */
export function purgeVotes(gameId: number, round: number, phase: string): void {
  const key = voteKey(gameId, round, phase);
  const count = phaseVotes.get(key)?.length ?? 0;
  phaseVotes.delete(key);
  console.log(`[store] Purged ${count} votes for game=${gameId} round=${round} phase=${phase}`);
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
