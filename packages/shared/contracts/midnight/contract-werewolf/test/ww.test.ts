/**
 * Werewolf Game Simulator & Test Suite
 * Compatible with the refactored Witness-based Contract
 *
 * Usage: npx tsx test/ww.test.ts
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

const ENCRYPTION_LIMITS = {
  NUM_MAX: 99,
  RND_MAX: 99,
  RAND_MAX: 999,
};

function packData(number: number, round: number, random: number): Uint8Array {
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

function deriveSessionKey(
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

function encryptPayload(
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

class RuntimeMerkleTree {
  private leaves: Uint8Array[];
  private levels: MerkleTreeDigest[][] = [];
  private root: MerkleTreeDigest = { field: 0n };
  private simulator: WerewolfSimulator;

  constructor(simulator: WerewolfSimulator, leaves: Uint8Array[]) {
    this.simulator = simulator;
    this.leaves = leaves;
  }

  async build() {
    const depth = 10;
    let currentLevel: MerkleTreeDigest[] = [];
    const totalLeaves = 1 << depth;
    const zeroBytes = new Uint8Array(32);

    // Compute digest for zero/padding leaf
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
    for (let level = 0; level < 10; level++) {
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

interface PlayerLocalState {
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

class WerewolfSimulator {
  readonly contract: Contract<PrivateState, typeof witnesses>;
  context: CircuitContext<PrivateState>;

  gameId: bigint;
  players: PlayerLocalState[] = [];

  // Admin Keys
  adminKey: Uint8Array; // Zswap Coin PK
  adminVotePublicKeyBytes: Uint8Array;
  adminEncKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };

  // Game Secrets
  masterSecret: Uint8Array;
  masterSecretCommitment: Uint8Array;

  constructor() {
    this.contract = new Contract(witnesses);

    // Initialize Private State
    const initialPrivateState: PrivateState = {
      setupData: new Map(),
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

    // Vote Encryption Keys (ECIES)
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
  }

  // Generic runner to execute a circuit and update context
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
    // Clone map to avoid reference issues
    newState.setupData = new Map(newState.setupData);
    update(newState);
    this.context.currentPrivateState = newState;
  }
}

// ============================================
// LOGGING UTILS
// ============================================

function logPass(name: string) {
  console.log(`  ✅ PASS: ${name}`);
}
function logFail(name: string, err: any) {
  console.log(`  ❌ FAIL: ${name}`);
  console.error(err);
}

// ============================================
// MAIN TEST SUITE
// ============================================

async function runTestSuite() {
  const sim = new WerewolfSimulator();
  const { circuits } = sim.contract;

  console.log("\n🧪 WEREWOLF CONTRACT TEST SUITE");

  // 1. SETUP KEYS & COMMITMENTS
  try {
    const r1 = await sim.runCircuit((ctx) => circuits.getAdminKey(ctx, sim.gameId));
    sim.adminKey = r1.bytes;

    const r2 = await sim.runCircuit((ctx) =>
      circuits.testComputeHash(ctx, sim.masterSecret)
    );
    sim.masterSecretCommitment = r2;

    logPass("Keys & Secrets Generated");
  } catch (e) {
    logFail("Setup Keys", e);
    return;
  }

  // 2. GENERATE PLAYERS & BUILD MERKLE TREE
  const playerCount = 5;
  const werewolfCount = 1;
  const leaves: Uint8Array[] = [];

  for (let i = 0; i < playerCount; i++) {
    const p: any = { id: i, alive: true };
    // Generate Random Secret for Player
    p.sk = new Uint8Array(
      createHash("sha256").update(`p${i}`).digest(),
    );
    p.encKeypair = nacl.box.keyPair();
    p.pk = p.encKeypair.publicKey;
    p.role = i < werewolfCount ? Role.Werewolf : Role.Villager;

    // Calc Salt
    const salt = await sim.runCircuit((ctx) =>
      circuits.testComputeSalt(ctx, sim.masterSecret, BigInt(i))
    );
    p.salt = salt;

    // Calc Commitment
    const comm = await sim.runCircuit((ctx) =>
      circuits.testComputeCommitment(ctx, BigInt(p.role), p.salt)
    );
    p.commitment = comm;

    // Calc Leaf Hash
    const leafHash = await sim.runCircuit((ctx) =>
      circuits.testComputeHash(ctx, p.sk)
    );
    p.leafHash = leafHash;

    leaves.push(leafHash);
    sim.players.push(p);
  }

  // Build Real Tree
  const tree = new RuntimeMerkleTree(sim, leaves);
  await tree.build();
  const root = tree.getRoot();

  // Generate Proofs for Players
  sim.players.forEach((p, i) => {
    p.merklePath = tree.getProof(i, p.leafHash);
  });

  // Verify Proofs Locally
  try {
    const valid = await sim.runCircuit((ctx) =>
      circuits.testVerifyMerkleProof(
        ctx,
        root,
        sim.players[0].leafHash,
        sim.players[0].merklePath!,
      )
    );
    if (valid) logPass("Merkle Tree Construction & Verification");
    else throw new Error("Verification returned false");
  } catch (e) {
    logFail("Merkle Verification", e);
    return;
  }

  // 3. CREATE GAME
  try {
    const roleCommitments = Array(16).fill(new Uint8Array(32));
    const encryptedRoles = Array(16).fill(new Uint8Array(3));
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
    });

    await sim.runCircuit((ctx) =>
      circuits.createGame(
        ctx,
        sim.gameId,
        sim.adminVotePublicKeyBytes,
        sim.masterSecretCommitment,
        BigInt(playerCount),
        BigInt(werewolfCount),
      )
    );
    logPass("createGame");
  } catch (e) {
    logFail("createGame", e);
    return;
  }

  // 4. NIGHT ACTION (Valid Vote)
  try {
    const actor = sim.players[0]; // Werewolf
    const targetIdx = 1;
    const actionRandom = 123;

    sim.updatePrivateState((state) => {
      state.nextAction = {
        targetNumber: targetIdx,
        random: actionRandom,
        merklePath: actor.merklePath!,
        leafSecret: actor.sk,
      };
      state.encryptionKeypair = actor.encKeypair;
    });

    await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
    logPass("nightAction (Valid)");
  } catch (e) {
    logFail("nightAction (Valid)", e);
  }

  // 5. DOUBLE VOTING (Should Fail)
  try {
    const actor = sim.players[0];
    // Attempt same vote again
    sim.updatePrivateState((state) => {
      state.nextAction = {
        targetNumber: 1,
        random: 123,
        merklePath: actor.merklePath!,
        leafSecret: actor.sk,
      };
      state.encryptionKeypair = actor.encKeypair;
    });

    await sim.runCircuit((ctx) => circuits.nightAction(ctx, sim.gameId));
    logFail(
      "nightAction (Double Vote Check)",
      new Error("Should have thrown error"),
    );
  } catch (e: any) {
    if (String(e).includes("Action already submitted")) {
      logPass("nightAction (Prevented Double Vote)");
    } else {
      logFail("nightAction (Double Vote Check) - Wrong Error", e);
    }
  }

  // 6. ADMIN PUNISH PLAYER (Did not vote)
  try {
    const afkPlayer = sim.players[4];
    // Check alive before
    const aliveBefore = await sim.runCircuit((ctx) =>
      circuits.isPlayerAlive(ctx, sim.gameId, BigInt(afkPlayer.id))
    );
    if (!aliveBefore) throw new Error("Player 4 should be alive");

    // Punish
    await sim.runCircuit((ctx) =>
      circuits.adminPunishPlayer(ctx, sim.gameId, BigInt(afkPlayer.id))
    );

    // Check dead
    const aliveAfter = await sim.runCircuit((ctx) =>
      circuits.isPlayerAlive(ctx, sim.gameId, BigInt(afkPlayer.id))
    );
    if (!aliveAfter) logPass("adminPunishPlayer (Eliminated non-voter)");
    else throw new Error("Player 4 is still alive after punishment");
  } catch (e) {
    logFail("adminPunishPlayer", e);
  }

  // 7. RESOLVE NIGHT
  try {
    // Kill P1
    await sim.runCircuit((ctx) =>
      circuits.resolveNightPhase(
        ctx,
        sim.gameId,
        2n, // New Round
        1n, // Dead Player P1
        true, // Has Death
        root, // Keep same root for test simplicity
      )
    );
    sim.players[1].alive = false;
    logPass("resolveNightPhase");
  } catch (e) {
    logFail("resolveNightPhase", e);
  }

  // 8. DAY VOTE (Round 2)
  try {
    const voter = sim.players[0]; // Same player who voted night (P0)
    // Should be able to vote again because Round Changed -> Nullifier Changed

    sim.updatePrivateState((state) => {
      state.nextAction = {
        targetNumber: 2, // Vote for P2
        random: 456,
        merklePath: voter.merklePath!,
        leafSecret: voter.sk,
      };
      state.encryptionKeypair = voter.encKeypair;
    });

    await sim.runCircuit((ctx) => circuits.voteDay(ctx, sim.gameId));
    logPass("voteDay (Round 2 - Nullifier Unique)");
  } catch (e) {
    logFail("voteDay (Round 2)", e);
  }

  // 9. END GAME
  try {
    await sim.runCircuit((ctx) =>
      circuits.forceEndGame(ctx, sim.gameId, sim.masterSecret)
    );
    logPass("forceEndGame");
  } catch (e) {
    logFail("forceEndGame", e);
  }

  console.log("\n✅ Test Suite Finished");
}

runTestSuite().catch(console.error);
