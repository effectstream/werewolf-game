/**
 * Trusted node (admin) for the werewolf simulation. It only reads contract
 * state (e.g. encrypted votes) to determine events and actions; it does not
 * import from the simulation main file.
 */
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import {
  type ActionData,
  type MerkleTreeDigest,
  type MerkleTreePath,
  type MerkleTreePathEntry,
  Role,
  type WitnessSet,
} from "./simulation-player.ts";

// =============================================================================
// TYPES
// =============================================================================

/** Minimal interface to run contract circuits; used for Merkle tree building. No dependency on simulation. */
export interface MerkleCircuitRunner<Ctx = unknown> {
  runCircuit<T>(
    fn: () => { context: Ctx; result: T },
  ): Promise<T>;
  contract: {
    circuits: {
      testLeafDigest(
        ctx: Ctx,
        data: Uint8Array,
      ): { context: Ctx; result: MerkleTreeDigest };
      testNodeDigest(
        ctx: Ctx,
        left: MerkleTreeDigest,
        right: MerkleTreeDigest,
      ): { context: Ctx; result: MerkleTreeDigest };
      testComputeSalt?(
        ctx: Ctx,
        nonce: Uint8Array,
        id: bigint,
      ): { context: Ctx; result: Uint8Array };
      testComputeCommitment?(
        ctx: Ctx,
        role: bigint,
        salt: Uint8Array,
      ): { context: Ctx; result: Uint8Array };
    };
  };
  context: Ctx;
}

export type SetupData = {
  roleCommitments: Uint8Array[];
  encryptedRoles: Uint8Array[];
  adminAuthKey: { bytes: Uint8Array };
  adminEncKey: Uint8Array;
  initialRoot: MerkleTreeDigest;
};

// =============================================================================
// CRYPTO (used by TrustedNode for role encryption and vote decryption)
// =============================================================================

const ENCRYPTION_LIMITS = {
  NUM_MAX: 99,
  RND_MAX: 99,
  RAND_MAX: 999,
};

function packData(number: number, round: number, random: number): Uint8Array {
  if (
    number > ENCRYPTION_LIMITS.NUM_MAX ||
    round > ENCRYPTION_LIMITS.RND_MAX ||
    random > ENCRYPTION_LIMITS.RAND_MAX
  ) {
    throw new Error("Overflow in packData");
  }
  const packed = (number << 17) | (round << 10) | random;
  const bytes = new Uint8Array(3);
  bytes[0] = (packed >> 16) & 0xff;
  bytes[1] = (packed >> 8) & 0xff;
  bytes[2] = packed & 0xff;
  return bytes;
}

function unpackData(
  bytes: Uint8Array,
): { target: number; round: number; random: number } {
  const packed = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  const target = (packed >> 17) & 0x7f;
  const round = (packed >> 10) & 0x7f;
  const random = packed & 0x3ff;
  return { target, round, random };
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

function xorPayload(payload: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    result[i] = payload[i] ^ key[i];
  }
  return result;
}

// =============================================================================
// TRUSTED NODE (ADMIN)
// =============================================================================

export interface TrustedNodeActor {
  getSetupData(): SetupData;
  getActionData?(round: bigint): ActionData;
}

export class TrustedNode implements TrustedNodeActor {
  public adminAuthKey: Uint8Array;
  public adminEncKey: Uint8Array;

  private masterSecret: Uint8Array;
  private initialRoot: MerkleTreeDigest = { field: 0n };
  private encKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };

  private commitments: Uint8Array[] = [];
  private encryptedRoles: Uint8Array[] = [];

  private playerPublicKeys: Map<number, Uint8Array> = new Map();
  private playerRoles: Map<number, number> = new Map();

  private leafHashes: Uint8Array[] = [];
  private alivePlayers: Set<number> = new Set();
  private currentTree: RuntimeMerkleTree<any> | null = null;

  constructor() {
    this.masterSecret = new Uint8Array(
      createHash("sha256").update("master").digest(),
    );
    this.encKeypair = nacl.box.keyPair();
    this.adminEncKey = this.encKeypair.publicKey;
    this.adminAuthKey = new Uint8Array(32);
  }

  setAuthKey(key: Uint8Array): void {
    this.adminAuthKey = key;
  }

  setCommitments(commits: Uint8Array[]): void {
    this.commitments = commits;
  }

  setInitialRoot(root: MerkleTreeDigest): void {
    this.initialRoot = root;
  }

  async preGameSetup<Ctx>(
    runner: MerkleCircuitRunner<Ctx>,
    playersInfo: { id: number; pubKey: Uint8Array; leafHash: Uint8Array }[]
  ): Promise<{ roles: number[]; tree: RuntimeMerkleTree<Ctx> }> {
    let numberOfWerewolves: number;
    if (playersInfo.length > 12) {
      numberOfWerewolves = 3;
    } else if (playersInfo.length > 8) {
      numberOfWerewolves = 2;
    } else {
      numberOfWerewolves = 1;
    }
    const roles = Array(playersInfo.length).fill(Role.Villager);
    for (let i = 0; i < numberOfWerewolves; i++) {
      const index = Math.floor(Math.random() * playersInfo.length);
      if (roles[index] === Role.Werewolf) {
        i--; // Retry if the role is already a werewolf
      } else {
        roles[index] = Role.Werewolf;
      }
    }

    const commitments: Uint8Array[] = [];
    const leafHashes: Uint8Array[] = [];

    for (const [i, p] of playersInfo.entries()) {
      leafHashes.push(p.leafHash);
      if (!runner.contract.circuits.testComputeSalt || !runner.contract.circuits.testComputeCommitment) {
        throw new Error("MerkleCircuitRunner missing compute salt/commitment circuits");
      }
      const salt = await runner.runCircuit(() =>
        runner.contract.circuits.testComputeSalt!(runner.context, new Uint8Array(32), BigInt(p.id))
      );

      const comm = await runner.runCircuit(() =>
        runner.contract.circuits.testComputeCommitment!(runner.context, BigInt(roles[i]), salt)
      );
      commitments.push(comm);

      this.registerPlayerKeys(p.id, p.pubKey, roles[i]);
    }
    
    this.setCommitments(commitments);

    console.log("Building Merkle Tree...");
    const tree = await this.initializeGameTree(runner, leafHashes);
    return { roles, tree };
  }

  async initializeGameTree<Ctx>(
    runner: MerkleCircuitRunner<Ctx>,
    leafHashes: Uint8Array[]
  ): Promise<RuntimeMerkleTree<Ctx>> {
    this.leafHashes = leafHashes;
    this.alivePlayers = new Set(leafHashes.map((_, i) => i));
    const tree = await buildInitialTree(runner, leafHashes);
    this.currentTree = tree;
    this.initialRoot = tree.getRoot();
    return tree;
  }

  async processNightElimination<Ctx>(
    runner: MerkleCircuitRunner<Ctx>,
    eliminatedIdx: number,
    hasElimination: boolean
  ): Promise<{ root: MerkleTreeDigest, tree: RuntimeMerkleTree<Ctx> }> {
    if (hasElimination) {
      this.alivePlayers.delete(eliminatedIdx);
    }
    const tree = await buildAliveTree(runner, this.leafHashes, this.alivePlayers);
    this.currentTree = tree;
    return { root: tree.getRoot(), tree };
  }

  registerPlayerKeys(id: number, pubKey: Uint8Array, role: number): void {
    this.playerPublicKeys.set(id, pubKey);
    this.playerRoles.set(id, role);

    const encRolePayload = packData(role, 0, id % 1000);
    const sessionKey = deriveSessionKey(
      this.encKeypair.secretKey,
      pubKey,
      0,
    );
    const encrypted = xorPayload(encRolePayload, sessionKey);

    if (this.encryptedRoles.length <= id) {
      this.encryptedRoles.length = id + 1;
    }
    this.encryptedRoles[id] = encrypted;
  }

  getSetupData(): SetupData {
    const paddedCommits = [...this.commitments];
    while (paddedCommits.length < 16) paddedCommits.push(new Uint8Array(32));

    const paddedRoles = [...this.encryptedRoles];
    while (paddedRoles.length < 16) paddedRoles.push(new Uint8Array(3));

    return {
      roleCommitments: paddedCommits,
      encryptedRoles: paddedRoles,
      adminAuthKey: { bytes: this.adminAuthKey },
      adminEncKey: this.adminEncKey,
      initialRoot: this.initialRoot,
    };
  }

  /** Returns this trusted node's witness set (setup data only; getActionData throws). */
  getWitness<PS, L>(): WitnessSet<PS, L> {
    const admin = this;
    return {
      wit_getRoleCommitment(ctx, _gid, n) {
        const setup = admin.getSetupData();
        const idx = Number(n);
        return [
          ctx.privateState,
          (idx >= 0 && idx < setup.roleCommitments.length)
            ? setup.roleCommitments[idx]
            : new Uint8Array(0),
        ];
      },
      wit_getEncryptedRole(ctx, _gid, n) {
        const setup = admin.getSetupData();
        const idx = Number(n);
        return [
          ctx.privateState,
          (idx >= 0 && idx < setup.encryptedRoles.length)
            ? setup.encryptedRoles[idx]
            : new Uint8Array(3),
        ];
      },
      wit_getInitialRoot(ctx) {
        return [ctx.privateState, admin.getSetupData().initialRoot];
      },
      wit_getActionData() {
        throw new Error("TrustedNode does not provide action data");
      },
    };
  }

  /**
   * Reads encrypted votes (from contract state) and determines elimination.
   * Off-chain only; on-chain only ciphertext is visible.
   */
  processVotesFromLedger(
    encryptedVotes: Uint8Array[],
    round: number,
    isNightPhase: boolean,
  ): { eliminatedIdx: number; hasElimination: boolean } {
    const votes = new Map<number, number>();

    console.log(`    [Node] Aggregating votes for Round ${round}...`);

    for (let i = 0; i < encryptedVotes.length; i++) {
      const ciphertext = encryptedVotes[i];
      if (ciphertext.every((b) => b === 0)) continue;

      let foundVoter = -1;
      let validData: { target: number; round: number; random: number } | null =
        null;

      for (const [playerId, playerPubKey] of this.playerPublicKeys.entries()) {
        const sessionKey = deriveSessionKey(
          this.encKeypair.secretKey,
          playerPubKey,
          round,
        );

        const plaintext = xorPayload(ciphertext, sessionKey);
        const data = unpackData(plaintext);

        if (data.round === round) {
          foundVoter = playerId;
          validData = data;
          break;
        }
      }

      if (foundVoter === -1 || !validData) {
        console.warn(`    [Node] ⚠️ Undecryptable vote at index ${i}`);
        continue;
      }

      if (isNightPhase) {
        const role = this.playerRoles.get(foundVoter);
        if (role !== Role.Werewolf) {
          continue;
        }
      }

      votes.set(validData.target, (votes.get(validData.target) || 0) + 1);
    }

    let maxVotes = 0;
    votes.forEach((count) => {
      if (count > maxVotes) maxVotes = count;
    });

    const tiedPlayers: number[] = [];
    votes.forEach((count, targetId) => {
      if (count === maxVotes) tiedPlayers.push(targetId);
    });

    if (tiedPlayers.length === 0 || maxVotes === 0) {
      return { eliminatedIdx: 0, hasElimination: false };
    }

    if (tiedPlayers.length > 1) {
      if (isNightPhase) {
        const target =
          tiedPlayers[Math.floor(Math.random() * tiedPlayers.length)];
        console.log(`    [Node] Night Tie. Randomly selected P${target}.`);
        return { eliminatedIdx: target, hasElimination: true };
      } else {
        console.log(`    [Node] Day Tie. No execution.`);
        return { eliminatedIdx: 0, hasElimination: false };
      }
    }

    console.log(`    [Node] Consensus on P${tiedPlayers[0]}`);
    return { eliminatedIdx: tiedPlayers[0], hasElimination: true };
  }
}

// =============================================================================
// RUNTIME MERKLE TREE (uses contract circuits; no simulation import)
// =============================================================================

const MERKLE_DEPTH = 10;
const TOTAL_LEAVES = 1 << MERKLE_DEPTH;

export class RuntimeMerkleTree<Ctx = unknown> {
  private leaves: Uint8Array[];
  private levels: MerkleTreeDigest[][] = [];
  private root: MerkleTreeDigest = { field: 0n };
  private runner: MerkleCircuitRunner<Ctx>;

  constructor(runner: MerkleCircuitRunner<Ctx>, leaves: Uint8Array[]) {
    this.runner = runner;
    this.leaves = leaves;
  }

  async build(): Promise<void> {
    const zeroBytes = new Uint8Array(32);

    const zeroLeafDigest = await this.runner.runCircuit(() =>
      this.runner.contract.circuits.testLeafDigest(
        this.runner.context,
        zeroBytes,
      )
    );

    let currentLevel: MerkleTreeDigest[] = [];
    for (let i = 0; i < TOTAL_LEAVES; i++) {
      if (i < this.leaves.length) {
        const digest = await this.runner.runCircuit(() =>
          this.runner.contract.circuits.testLeafDigest(
            this.runner.context,
            this.leaves[i],
          )
        );
        currentLevel.push(digest);
      } else {
        currentLevel.push(zeroLeafDigest);
      }
    }
    this.levels.push(currentLevel);

    for (let d = 0; d < MERKLE_DEPTH; d++) {
      const nextLevel: MerkleTreeDigest[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const parent = await this.runner.runCircuit(() =>
          this.runner.contract.circuits.testNodeDigest(
            this.runner.context,
            left,
            right,
          )
        );
        nextLevel.push(parent);
      }
      this.levels.push(nextLevel);
      currentLevel = nextLevel;
    }
    this.root = currentLevel[0];
  }

  getRoot(): MerkleTreeDigest {
    return this.root;
  }

  getProof(index: number, leaf: Uint8Array): MerkleTreePath {
    const path: MerkleTreePathEntry[] = [];
    let idx = index;
    for (let level = 0; level < MERKLE_DEPTH; level++) {
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

/** Build initial Merkle tree from all player leaf hashes (padded to tree size). */
export async function buildInitialTree<Ctx>(
  runner: MerkleCircuitRunner<Ctx>,
  leafHashes: Uint8Array[],
): Promise<RuntimeMerkleTree<Ctx>> {
  const zeroBytes = new Uint8Array(32);
  const leaves: Uint8Array[] = [];
  for (let i = 0; i < TOTAL_LEAVES; i++) {
    leaves.push(i < leafHashes.length ? leafHashes[i] : zeroBytes);
  }
  const tree = new RuntimeMerkleTree(runner, leaves);
  await tree.build();
  return tree;
}

/** Build Merkle tree over current alive set (zeros for dead indices). */
export async function buildAliveTree<Ctx>(
  runner: MerkleCircuitRunner<Ctx>,
  leafHashes: Uint8Array[],
  alivePlayerIds: Set<number>,
): Promise<RuntimeMerkleTree<Ctx>> {
  const zeroBytes = new Uint8Array(32);
  const leaves: Uint8Array[] = [];
  for (let i = 0; i < TOTAL_LEAVES; i++) {
    if (
      i < leafHashes.length &&
      alivePlayerIds.has(i)
    ) {
      leaves.push(leafHashes[i]);
    } else {
      leaves.push(zeroBytes);
    }
  }
  const tree = new RuntimeMerkleTree(runner, leaves);
  await tree.build();
  return tree;
}
