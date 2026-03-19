/**
 * Server-side bundle generation for the werewolf game.
 *
 * Extracted from packages/frontend/dApp/client/src/App.tsx so that the node
 * server can generate bundles autonomously after a lobby closes, without
 * requiring a frontend admin.
 *
 * Dependencies:
 *   - pureCircuits / Contract class from the compiled Compact contract
 *   - tweetnacl for keypair generation
 */

import {
  pureCircuits,
} from "../contracts/midnight/contract-werewolf/src/managed/contract/index.js";
import nacl from "tweetnacl";
import Prando from "prando";

// Deno's ESM resolution for the 'prando' NPM package sometimes treats it as a module
// rather than a class. This hack ensures we get the constructable class at runtime.
const PrandoClass = (Prando as any).default || Prando;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PLAYERS = 16;

const Role = {
  Villager: 0,
  Werewolf: 1,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlayerBundle = {
  gameId: string;
  playerId: number;
  leafSecret: string; // 32-byte hex (64 chars)
  merklePath: { sibling: { field: string }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
};

export type BundleGenerationResult = {
  masterSecret: Uint8Array;
  masterSecretCommitment: Uint8Array;
  adminVoteKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  adminVotePublicKeyHex: string;
  adminSignKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  adminSignPublicKeyHex: string;
  roles: number[];
  playerBundles: PlayerBundle[];
  merkleRoot: { field: bigint };
  roleCommitments: Uint8Array[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function randomBytes32(): Uint8Array {
  return randomBytes(32);
}

function toHexString(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${toHexString(bytes)}`;
}

function shuffle<T>(items: T[], prando?: any): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = prando
      ? prando.nextInt(0, i)
      : Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// RuntimeMerkleTree — builds a merkle tree using stable exported pure circuits
// so it does not depend on regenerated private helper names.
// ---------------------------------------------------------------------------

export class RuntimeMerkleTree {
  readonly depth: number;
  readonly leaves: Uint8Array[];
  readonly leafDigests: bigint[];
  readonly levels: bigint[][];
  readonly root: { field: bigint };

  constructor(leaves: Uint8Array[], depth = 10) {
    this.depth = depth;
    this.leaves = leaves;

    const totalLeaves = 1 << depth;
    const zeroLeaf = new Uint8Array(32);
    const zeroDigest = this.computeLeafDigest(zeroLeaf);

    const digests = new Array<bigint>(totalLeaves);
    for (let i = 0; i < totalLeaves; i++) {
      const leaf = i < leaves.length ? leaves[i] : zeroLeaf;
      digests[i] = i < leaves.length
        ? this.computeLeafDigest(leaf)
        : zeroDigest;
    }

    this.leafDigests = digests;
    this.levels = [digests];

    for (let level = 0; level < depth; level++) {
      const prev = this.levels[level];
      const next: bigint[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        next.push(this.hashPair(prev[i], prev[i + 1]));
      }
      this.levels.push(next);
    }

    this.root = { field: this.levels[depth][0] };
  }

  getRoot(): { field: bigint } {
    return this.root;
  }

  getProof(
    index: number,
    _leaf: Uint8Array,
  ): {
    leaf: Uint8Array;
    path: { sibling: { field: bigint }; goes_left: boolean }[];
  } {
    const pathEntries: { sibling: { field: bigint }; goes_left: boolean }[] =
      [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      const siblingIdx = idx ^ 1;
      const siblingDigest = this.levels[level][siblingIdx];
      const goes_left = idx % 2 === 0;
      pathEntries.push({ sibling: { field: siblingDigest }, goes_left });
      idx = Math.floor(idx / 2);
    }
    return { leaf: _leaf, path: pathEntries };
  }

  private computeLeafDigest(leaf: Uint8Array): bigint {
    return pureCircuits.testLeafDigest(leaf).field;
  }

  private hashPair(left: bigint, right: bigint): bigint {
    return pureCircuits.testNodeDigest({ field: left }, { field: right }).field;
  }
}

// ---------------------------------------------------------------------------
// Bundle Generation
// ---------------------------------------------------------------------------

/**
 * Generate all bundles for a game after the lobby has closed.
 *
 * @param gameId       - The game ID (uint32).
 * @param playerCount  - Number of players in the lobby (2-16).
 * @param werewolfCount - Number of werewolves to assign.
 * @returns BundleGenerationResult with all cryptographic material.
 */
export function generateBundles(
  gameId: bigint | number,
  playerCount: number,
  werewolfCount: number,
  gameSeed?: Uint8Array,
): BundleGenerationResult {
  if (playerCount < 2 || playerCount > MAX_PLAYERS) {
    throw new Error(
      `playerCount must be between 2 and ${MAX_PLAYERS} (got ${playerCount})`,
    );
  }
  if (werewolfCount < 1 || werewolfCount >= playerCount) {
    throw new Error(
      `werewolfCount must be between 1 and ${
        playerCount - 1
      } (got ${werewolfCount})`,
    );
  }

  const gameIdStr = gameId.toString();
  // Initialize deterministic PRNG if gameSeed is provided.
  const prando = gameSeed ? new PrandoClass(toHexString(gameSeed)) : null;

  const detRandomBytes = (len: number): Uint8Array => {
    if (prando) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = prando.nextInt(0, 255);
      }
      return bytes;
    }
    return randomBytes(len);
  };

  // --- Generate admin keys ---
  // Both keypairs are derived from detRandomBytes so they are fully
  // reproducible from gameSeed after a server restart.
  const adminVoteSecret = detRandomBytes(32);
  const adminVoteKeypair = nacl.box.keyPair.fromSecretKey(adminVoteSecret);
  const adminVotePublicKeyBytes = new Uint8Array(33);
  adminVotePublicKeyBytes.set(adminVoteKeypair.publicKey);
  const adminVotePublicKeyHex = bytesToHex(adminVotePublicKeyBytes);

  const adminSignSeed = detRandomBytes(32);
  const adminSignKeypair = nacl.sign.keyPair.fromSeed(adminSignSeed);
  const adminSignPublicKeyHex = bytesToHex(adminSignKeypair.publicKey);

  // --- Generate master secret ---
  const masterSecret = detRandomBytes(32);
  const masterSecretCommitment = new Uint8Array(
    pureCircuits.testComputeHash(masterSecret),
  );

  // --- Shuffle roles ---
  const roles = shuffle(
    Array.from(
      { length: playerCount },
      (_, idx) => idx < werewolfCount ? Role.Werewolf : Role.Villager,
    ),
    prando,
  );

  // --- Generate per-player data ---
  const playerLeaves: Uint8Array[] = [];
  const roleCommitments: Uint8Array[] = [];
  const playerSecrets: {
    sk: Uint8Array;
    salt: Uint8Array;
    commitment: Uint8Array;
    leaf: Uint8Array;
  }[] = [];

  for (let id = 0; id < playerCount; id++) {
    const sk = detRandomBytes(32);
    const salt = new Uint8Array(
      (pureCircuits as any).testComputeSalt(masterSecret, BigInt(id)),
    );
    const commitment = new Uint8Array(
      (pureCircuits as any).testComputeCommitment(BigInt(roles[id]), salt),
    );
    const leaf = new Uint8Array(
      (pureCircuits as any).testComputeHash(sk),
    );

    playerSecrets.push({ sk, salt, commitment, leaf });
    playerLeaves.push(leaf);
    roleCommitments.push(commitment);
  }

  // --- Build merkle tree ---
  const tree = new RuntimeMerkleTree(playerLeaves);
  const merkleRoot = tree.getRoot();

  // --- Package bundles ---
  const playerBundles: PlayerBundle[] = playerSecrets.map((player, id) => {
    const proof = tree.getProof(id, player.leaf);
    return {
      gameId: gameIdStr,
      playerId: id,
      leafSecret: bytesToHex(player.sk),
      merklePath: proof.path.map((entry) => ({
        sibling: { field: entry.sibling.field.toString() },
        goes_left: entry.goes_left,
      })),
      adminVotePublicKeyHex,
      role: roles[id],
    };
  });

  return {
    masterSecret,
    masterSecretCommitment,
    adminVoteKeypair,
    adminVotePublicKeyHex,
    adminSignKeypair,
    adminSignPublicKeyHex,
    roles,
    playerBundles,
    merkleRoot,
    roleCommitments,
  };
}
