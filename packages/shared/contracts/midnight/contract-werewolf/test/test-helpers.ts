/**
 * Shared test helpers for the Werewolf contract test suites.
 * Extracted from ww.test.ts to be reusable across test files.
 */
import {
  type CircuitContext,
  CostModel,
  createConstructorContext,
  QueryContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { PrivateKey } from "eciesjs";
import nacl from "tweetnacl";
import { Contract } from "../src/managed/contract/index.js";
import {
  type MerkleTreeDigest,
  type MerkleTreePath,
  type MerkleTreePathEntry,
  type PrivateState,
  witnesses,
} from "../src/witnesses.ts";
import {
  computeRoundActionsDigest,
  computeVoteNullifier,
} from "../../../../utils/round-actions-digest.ts";

// Re-export for convenience
export {
  type CircuitContext,
  type MerkleTreeDigest,
  type MerkleTreePath,
  type MerkleTreePathEntry,
  type PrivateState,
  QueryContext,
  sampleContractAddress,
  computeRoundActionsDigest,
  computeVoteNullifier,
};

// ============================================
// TYPES & INTERFACES
// ============================================

export const Role = {
  Villager: 0,
  Werewolf: 1,
  Seer: 2,
  Doctor: 3,
};

export const Phase = {
  Lobby: 0,
  Night: 1,
  Day: 2,
  Finished: 3,
};

// ============================================
// CRYPTO HELPERS (Client Side)
// ============================================

export const ENCRYPTION_LIMITS = {
  NUM_MAX: 99,
  RND_MAX: 99,
  RAND_MAX: 999,
};

export function packData(number: number, round: number, random: number): Uint8Array {
  if (
    number > ENCRYPTION_LIMITS.NUM_MAX || round > ENCRYPTION_LIMITS.RND_MAX ||
    random > ENCRYPTION_LIMITS.RAND_MAX
  ) {
    throw new Error("Overflow in packData");
  }
  const packed = (number << 17) | (round << 10) | random;
  const bytes = new Uint8Array(3);
  bytes[0] = (packed >> 16) & 0xFF;
  bytes[1] = (packed >> 8) & 0xFF;
  bytes[2] = packed & 0xFF;
  return bytes;
}

export function deriveSessionKey(
  myPrivKey: Uint8Array,
  theirPubKey: Uint8Array,
  txNonce: number,
): Uint8Array {
  const sharedPoint = nacl.scalarMult(myPrivKey, theirPubKey);
  const nonceBytes = new Uint8Array(new Int32Array([txNonce]).buffer);
  const combined = new Uint8Array(sharedPoint.length + nonceBytes.length);
  combined.set(sharedPoint);
  combined.set(nonceBytes, sharedPoint.length);
  return nacl.hash(combined).slice(0, 3);
}

export function encryptPayload(
  number: number,
  round: number,
  random: number,
  myPrivKey: Uint8Array,
  receiverPubKey: Uint8Array,
  txNonce: number,
): Uint8Array {
  const payload = packData(number, round, random);
  const key = deriveSessionKey(myPrivKey, receiverPubKey, txNonce);
  const ciphertext = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    ciphertext[i] = payload[i] ^ key[i];
  }
  return ciphertext;
}

// ============================================
// REAL MERKLE TREE (Uses Contract Circuits)
// ============================================

export class RuntimeMerkleTree {
  private leaves: Uint8Array[];
  private levels: MerkleTreeDigest[][] = [];
  private root: MerkleTreeDigest = { field: 0n };
  private simulator: WerewolfSimulator;

  constructor(simulator: WerewolfSimulator, leaves: Uint8Array[]) {
    this.simulator = simulator;
    this.leaves = leaves;
  }

  async build() {
    const depth = 5;
    let currentLevel: MerkleTreeDigest[] = [];
    const totalLeaves = 1 << depth;
    const zeroBytes = new Uint8Array(32);

    const zeroLeafDigest = await this.simulator.runCircuit((ctx) =>
      this.simulator.contract.circuits.testLeafDigest(ctx, zeroBytes)
    );

    for (let i = 0; i < totalLeaves; i++) {
      if (i < this.leaves.length) {
        const digest = await this.simulator.runCircuit((ctx) =>
          this.simulator.contract.circuits.testLeafDigest(ctx, this.leaves[i])
        );
        currentLevel.push(digest);
      } else {
        currentLevel.push(zeroLeafDigest);
      }
    }

    this.levels.push(currentLevel);

    for (let d = 0; d < depth; d++) {
      const nextLevel: MerkleTreeDigest[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const parent = await this.simulator.runCircuit((ctx) =>
          this.simulator.contract.circuits.testNodeDigest(ctx, left, right)
        );
        nextLevel.push(parent);
      }
      this.levels.push(nextLevel);
      currentLevel = nextLevel;
    }

    this.root = currentLevel[0];
  }

  getRoot() {
    return this.root;
  }

  getProof(index: number, leaf: Uint8Array): MerkleTreePath {
    const path: MerkleTreePathEntry[] = [];
    let idx = index;
    for (let level = 0; level < 5; level++) {
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      const siblingDigest = this.levels[level][siblingIdx];
      path.push({
        sibling: siblingDigest,
        goes_left: !isRight,
      });
      idx = Math.floor(idx / 2);
    }
    return { leaf, path };
  }
}

// ============================================
// SIMULATOR CLASS
// ============================================

export interface PlayerLocalState {
  id: number;
  pk: Uint8Array;
  sk: Uint8Array;
  encKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  role: number;
  salt: Uint8Array;
  alive: boolean;
  commitment: Uint8Array;
  leafHash: Uint8Array;
  merklePath?: MerkleTreePath;
}

export class WerewolfSimulator {
  readonly contract: Contract<PrivateState, typeof witnesses>;
  context: CircuitContext<PrivateState>;

  gameId: bigint;
  players: PlayerLocalState[] = [];

  // Admin Keys
  adminKey: Uint8Array;
  adminVotePublicKeyBytes: Uint8Array;
  adminEncKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };

  // Game Secrets
  masterSecret: Uint8Array;
  masterSecretCommitment: Uint8Array;
  adminSecret: Uint8Array;
  adminSecretCommitment: bigint;

  constructor() {
    this.contract = new Contract(witnesses);

    const initialPrivateState: PrivateState = {
      setupData: new Map(),
      adminSecrets: new Map(),
      nextAction: undefined,
    };

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext(initialPrivateState, "0".repeat(64)),
    );

    this.context = {
      currentPrivateState,
      currentZswapLocalState,
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
      costModel: CostModel.initialCostModel(),
    };

    this.gameId = BigInt(Math.floor(Math.random() * 0xFFFFFFFF));
    this.adminKey = new Uint8Array(32);

    const adminVoteKey = new PrivateKey();
    this.adminVotePublicKeyBytes = Buffer.from(
      adminVoteKey.publicKey.toHex(),
      "hex",
    );
    this.adminEncKeypair = nacl.box.keyPair();

    this.masterSecret = new Uint8Array(
      createHash("sha256").update(Math.random().toString()).digest(),
    );
    this.masterSecretCommitment = new Uint8Array(32);

    this.adminSecret = new Uint8Array(
      createHash("sha256").update(Math.random().toString()).digest(),
    );
    this.adminSecretCommitment = 0n; // computed in setupGameReady
  }

  async runCircuit<T>(
    fn: (ctx: CircuitContext<PrivateState>) => {
      context: CircuitContext<PrivateState>;
      result: T;
    },
  ): Promise<T> {
    const res = await fn(this.context);
    this.context = res.context;
    return res.result;
  }

  updatePrivateState(update: (state: PrivateState) => void) {
    const newState = { ...this.context.currentPrivateState };
    newState.setupData = new Map(newState.setupData);
    newState.adminSecrets = new Map(newState.adminSecrets);
    update(newState);
    this.context.currentPrivateState = newState;
  }
}

// ============================================
// LOGGING UTILS
// ============================================

export function logPass(name: string) {
  console.log(`  \u2705 PASS: ${name}`);
}

export function logFail(name: string, err: any) {
  console.log(`  \u274C FAIL: ${name}`);
  console.error(err);
}

// ============================================
// GAME SETUP HELPERS
// ============================================

/**
 * Sets up a game ready for voting: creates simulator, generates players,
 * builds Merkle tree, and calls createGame.
 */
export async function setupGameReady(
  playerCount: number,
  werewolfCount: number,
): Promise<{
  sim: WerewolfSimulator;
  tree: RuntimeMerkleTree;
  root: MerkleTreeDigest;
}> {
  const sim = new WerewolfSimulator();
  const { circuits } = sim.contract;

  // Generate master secret commitment
  const r2 = await sim.runCircuit((ctx) =>
    circuits.testComputeHash(ctx, sim.masterSecret)
  );
  sim.masterSecretCommitment = r2 as unknown as Uint8Array;

  // Generate admin secret commitment (Field)
  sim.adminSecretCommitment = await sim.runCircuit((ctx) =>
    circuits.testComputeAdminSecretCommitment(ctx, sim.adminSecret)
  ) as unknown as bigint;

  // Generate players
  const leaves: Uint8Array[] = [];
  for (let i = 0; i < playerCount; i++) {
    const p: any = { id: i, alive: true };
    p.sk = new Uint8Array(
      createHash("sha256").update(`p${i}`).digest(),
    );
    p.encKeypair = nacl.box.keyPair();
    p.pk = p.encKeypair.publicKey;
    p.role = i < werewolfCount ? Role.Werewolf : Role.Villager;

    const salt = await sim.runCircuit((ctx) =>
      circuits.testComputeSalt(ctx, sim.masterSecret, BigInt(i))
    );
    p.salt = salt;

    const comm = await sim.runCircuit((ctx) =>
      circuits.testComputeCommitment(ctx, BigInt(p.role), p.salt)
    );
    p.commitment = comm;

    const leafHash = await sim.runCircuit((ctx) =>
      circuits.testComputeHash(ctx, p.sk)
    );
    p.leafHash = leafHash;

    leaves.push(leafHash);
    sim.players.push(p);
  }

  // Build Merkle tree
  const tree = new RuntimeMerkleTree(sim, leaves);
  await tree.build();
  const root = tree.getRoot();

  // Generate proofs
  sim.players.forEach((p, i) => {
    p.merklePath = tree.getProof(i, p.leafHash);
  });

  // Create game
  const roleCommitments = Array(32).fill(new Uint8Array(32));
  const encryptedRoles = Array(32).fill(new Uint8Array(3));
  sim.players.forEach((p) => roleCommitments[p.id] = p.commitment);
  sim.players.forEach((p) => {
    encryptedRoles[p.id] = encryptPayload(
      p.role,
      0,
      p.id % 1000,
      sim.adminEncKeypair.secretKey,
      p.encKeypair.publicKey,
      0,
    );
  });

  sim.updatePrivateState((state) => {
    state.setupData.set(String(sim.gameId), {
      roleCommitments,
      encryptedRoles,
      adminKey: { bytes: sim.adminKey },
      initialRoot: root,
    });
    state.adminSecrets = new Map([
      [String(sim.gameId), sim.adminSecret],
    ]);
  });

  await sim.runCircuit((ctx) =>
    circuits.createGame(
      ctx,
      sim.gameId,
      sim.adminVotePublicKeyBytes,
      sim.adminSecretCommitment,
      sim.masterSecretCommitment,
      BigInt(playerCount),
      BigInt(werewolfCount),
    )
  );

  return { sim, tree, root };
}

/**
 * Submits a night vote from the given player and resolves the night phase,
 * advancing the game to Day. Returns the updated tree (with deadIdx removed if applicable).
 */
export async function advanceToDay(
  sim: WerewolfSimulator,
  tree: RuntimeMerkleTree,
  root: MerkleTreeDigest,
  voterIdx: number,
  targetIdx: number,
  killTarget: boolean,
): Promise<{ newTree: RuntimeMerkleTree; newRoot: MerkleTreeDigest }> {
  const { circuits } = sim.contract;
  const voter = sim.players[voterIdx];

  // Submit night vote
  sim.updatePrivateState((state) => {
    state.nextAction = {
      targetNumber: targetIdx,
      random: 123,
      merklePath: voter.merklePath!,
      leafSecret: voter.sk,
    };
    state.encryptionKeypair = voter.encKeypair;
  });

  await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));

  // Build digest
  const nightEncryptedAction = encryptPayload(
    targetIdx,
    1,
    123,
    voter.encKeypair.secretKey,
    sim.adminVotePublicKeyBytes.slice(0, 32),
    1,
  );
  const nightDigest = computeRoundActionsDigest(sim.gameId, 1, Phase.Night, [
    {
      nullifier: computeVoteNullifier(sim.gameId, 1, Phase.Night, voter.sk),
      encryptedAction: nightEncryptedAction,
    },
  ]);

  // Build new tree (removing dead player if kill)
  let newRoot = root;
  let newTree = tree;
  if (killTarget) {
    const leaves: Uint8Array[] = [];
    for (let i = 0; i < sim.players.length; i++) {
      if (i === targetIdx) {
        leaves.push(new Uint8Array(32)); // zero out dead player
      } else {
        leaves.push(sim.players[i].leafHash);
      }
    }
    newTree = new RuntimeMerkleTree(sim, leaves);
    await newTree.build();
    newRoot = newTree.getRoot();
    sim.players[targetIdx].alive = false;

    // Update proofs for alive players
    sim.players.forEach((p, i) => {
      if (p.alive) {
        p.merklePath = newTree.getProof(i, p.leafHash);
      }
    });
  }

  // Resolve night
  await sim.runCircuit((ctx) =>
    circuits.resolveNightPhase(
      ctx,
      sim.gameId,
      2n,
      BigInt(killTarget ? targetIdx : 0),
      killTarget,
      newRoot,
      nightDigest,
    )
  );

  return { newTree, newRoot };
}

/**
 * Builds an alive tree excluding the specified dead player indices.
 */
export async function buildAliveTree(
  sim: WerewolfSimulator,
  deadIndices: number[],
): Promise<{ tree: RuntimeMerkleTree; root: MerkleTreeDigest }> {
  const leaves: Uint8Array[] = [];
  const deadSet = new Set(deadIndices);
  for (let i = 0; i < sim.players.length; i++) {
    if (deadSet.has(i)) {
      leaves.push(new Uint8Array(32));
    } else {
      leaves.push(sim.players[i].leafHash);
    }
  }
  const tree = new RuntimeMerkleTree(sim, leaves);
  await tree.build();
  return { tree, root: tree.getRoot() };
}
