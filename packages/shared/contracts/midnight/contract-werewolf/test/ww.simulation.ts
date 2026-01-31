import {
  type CircuitContext,
  CostModel,
  createConstructorContext,
  QueryContext,
  sampleContractAddress,
  type WitnessContext,
} from "@midnight-ntwrk/compact-runtime";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import { Contract } from "../src/managed/contract/index.js";

// =============================================================================
// 1. TYPES & CRYPTO
// =============================================================================

export const Role = { Villager: 0, Werewolf: 1, Seer: 2, Doctor: 3 };
export const Phase = { Lobby: 0, Night: 1, Day: 2, Finished: 3 };

type MerkleTreeDigest = { field: bigint };
type MerkleTreePathEntry = { sibling: MerkleTreeDigest; goes_left: boolean };
type MerkleTreePath = { leaf: Uint8Array; path: MerkleTreePathEntry[] };

const ENCRYPTION_LIMITS = {
  NUM_MAX: 99,
  RND_MAX: 99,
  RAND_MAX: 999,
};

// --- PACKING ---

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

function unpackData(
  bytes: Uint8Array,
): { target: number; round: number; random: number } {
  const packed = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  const target = (packed >> 17) & 0x7F; // 7 bits
  const round = (packed >> 10) & 0x7F; // 7 bits
  const random = packed & 0x3FF; // 10 bits
  return { target, round, random };
}

// --- ENCRYPTION / DECRYPTION ---

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

function xorPayload(
  payload: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    result[i] = payload[i] ^ key[i];
  }
  return result;
}

// =============================================================================
// 2. DATA STRUCTURES
// =============================================================================

type SetupData = {
  roleCommitments: Uint8Array[];
  encryptedRoles: Uint8Array[];
  adminAuthKey: { bytes: Uint8Array }; // Key for state.adminKey (Auth)
  adminEncKey: Uint8Array; // Key for encryption
  initialRoot: MerkleTreeDigest;
};

type ActionData = {
  encryptedAction: Uint8Array;
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array;
};

type PrivateState = {
  activeActor?: Actor;
};

type Ledger = any;

interface Actor {
  getSetupData?(): SetupData;
  getActionData?(round: bigint): ActionData;
}

// =============================================================================
// 3. PLAYERS
// =============================================================================

class Player implements Actor {
  readonly id: number;
  readonly leafSecret: Uint8Array;
  readonly encKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };

  leafHash?: Uint8Array;
  merklePath?: MerkleTreePath;

  role: number = Role.Villager;
  adminEncKey?: Uint8Array; // The key used to encrypt votes
  isAlive: boolean = true;

  knownAlivePlayers: number[] = [];

  constructor(id: number) {
    this.id = id;
    this.leafSecret = new Uint8Array(
      createHash("sha256").update(`p${id}_${Math.random()}`).digest(),
    );
    this.encKeypair = nacl.box.keyPair();
  }

  receiveGameConfig(
    role: number,
    adminEncKey: Uint8Array,
    totalPlayers: number,
  ) {
    this.role = role;
    this.adminEncKey = adminEncKey;
    this.knownAlivePlayers = Array.from({ length: totalPlayers }, (_, i) => i);
  }

  getActionData(round: bigint): ActionData {
    if (!this.adminEncKey) {
      throw new Error(`P${this.id}: No Admin Encryption Key`);
    }
    if (!this.merklePath) throw new Error(`P${this.id}: No Merkle Path`);

    const targetIdx = this.chooseTarget();
    const random = Math.floor(Math.random() * 1000);

    const payload = packData(targetIdx, Number(round), random);

    // Encrypt for Admin using Round as Nonce
    const sessionKey = deriveSessionKey(
      this.encKeypair.secretKey,
      this.adminEncKey,
      Number(round),
    );
    const encryptedBuffer = xorPayload(payload, sessionKey);

    const roleEmoji = this.role === Role.Werewolf ? "🐺" : "👤";
    console.log(
      `    ${roleEmoji} P${this.id} submitting vote for P${targetIdx} (Encrypted: ${
        Buffer.from(encryptedBuffer).toString("hex")
      })`,
    );

    return {
      encryptedAction: encryptedBuffer,
      merklePath: this.merklePath,
      leafSecret: this.leafSecret,
    };
  }

  private chooseTarget(): number {
    const validTargets = this.knownAlivePlayers.filter((id) => id !== this.id);
    if (validTargets.length === 0) return this.id;
    const choice =
      validTargets[Math.floor(Math.random() * validTargets.length)];
    return choice;
  }

  updateAliveStatus(deadId: number) {
    this.knownAlivePlayers = this.knownAlivePlayers.filter((id) =>
      id !== deadId
    );
  }
}

// =============================================================================
// 4. TRUSTED NODE (ADMIN)
// =============================================================================

class TrustedNode implements Actor {
  public adminAuthKey: Uint8Array; // Matches std_ownPublicKey()
  public adminEncKey: Uint8Array; // Generated Keypair for Encryption

  private masterSecret: Uint8Array;
  private initialRoot: MerkleTreeDigest = { field: 0n };
  private encKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };

  private commitments: Uint8Array[] = [];
  private encryptedRoles: Uint8Array[] = [];

  private playerPublicKeys: Map<number, Uint8Array> = new Map();
  private playerRoles: Map<number, number> = new Map();

  constructor() {
    this.masterSecret = new Uint8Array(
      createHash("sha256").update("master").digest(),
    );
    this.encKeypair = nacl.box.keyPair();
    this.adminEncKey = this.encKeypair.publicKey;
    this.adminAuthKey = new Uint8Array(32); // Initial placeholder
  }

  setAuthKey(key: Uint8Array) {
    this.adminAuthKey = key;
  }

  setCommitments(commits: Uint8Array[]) {
    this.commitments = commits;
  }

  setInitialRoot(root: MerkleTreeDigest) {
    this.initialRoot = root;
  }

  registerPlayerKeys(id: number, pubKey: Uint8Array, role: number) {
    this.playerPublicKeys.set(id, pubKey);
    this.playerRoles.set(id, role);

    // Nonce 0 for setup role encryption
    const encRolePayload = packData(role, 0, id % 1000);
    const sessionKey = deriveSessionKey(this.encKeypair.secretKey, pubKey, 0);
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

  processVotesFromLedger(
    encryptedVotes: Uint8Array[], // Vector<16, Bytes<3>>
    round: number,
    isNightPhase: boolean,
  ): { eliminatedIdx: number; hasElimination: boolean } {
    const votes = new Map<number, number>();

    console.log(`    [Node] Decrypting votes for Round ${round}...`);

    // Iterate through anonymous votes from contract
    for (let i = 0; i < encryptedVotes.length; i++) {
      const ciphertext = encryptedVotes[i];
      if (ciphertext.every((b) => b === 0)) continue;

      let foundVoter = -1;
      let validData: { target: number; round: number; random: number } | null =
        null;

      // TRIAL DECRYPTION: Try every known player key
      for (const [playerId, playerPubKey] of this.playerPublicKeys.entries()) {
        // Derive session key assuming this player sent it
        const sessionKey = deriveSessionKey(
          this.encKeypair.secretKey,
          playerPubKey,
          round,
        );

        const plaintext = xorPayload(ciphertext, sessionKey);
        const data = unpackData(plaintext);

        // CHECK VALIDITY
        // 1. Round must match exactly (Strongest Check)
        // 2. Target must be valid index (0-15) - Optional but good
        if (data.round === round) {
          foundVoter = playerId;
          validData = data;
          // We found the sender!
          // console.log(`    [Node] Identified vote from P${playerId}`);
          break;
        }
      }

      if (foundVoter === -1 || !validData) {
        // Vote could not be decrypted with any known key for this round
        console.warn(`    [Node] ⚠️ Undecryptable vote at index ${i}`);
        continue;
      }

      // We know WHO sent it (foundVoter). Now apply rules.
      if (isNightPhase) {
        const role = this.playerRoles.get(foundVoter);
        if (role !== Role.Werewolf) {
          // Villager tried to vote at night. Ignore.
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
// 5. RUNTIME MERKLE TREE
// =============================================================================

class RuntimeMerkleTree {
  private leaves: Uint8Array[];
  private levels: MerkleTreeDigest[][] = [];
  private root: MerkleTreeDigest = { field: 0n };
  private simulation: Simulation;

  constructor(simulation: Simulation, leaves: Uint8Array[]) {
    this.simulation = simulation;
    this.leaves = leaves;
  }

  async build() {
    const depth = 10;
    let currentLevel: MerkleTreeDigest[] = [];
    const totalLeaves = 1 << depth;
    const zeroBytes = new Uint8Array(32);

    const zeroLeafDigest = await this.simulation.runCircuit(() =>
      this.simulation.contract.circuits.testLeafDigest(
        this.simulation.context,
        zeroBytes,
      )
    );

    for (let i = 0; i < totalLeaves; i++) {
      if (i < this.leaves.length) {
        const digest = await this.simulation.runCircuit(() =>
          this.simulation.contract.circuits.testLeafDigest(
            this.simulation.context,
            this.leaves[i],
          )
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
        const parent = await this.simulation.runCircuit(() =>
          this.simulation.contract.circuits.testNodeDigest(
            this.simulation.context,
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

// =============================================================================
// 6. SIMULATION RUNNER
// =============================================================================

const witnesses = {
  // Returns Commitments
  wit_getRoleCommitment: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    _gid: any,
    n: any,
  ) => {
    const setup = privateState.activeActor!.getSetupData!();
    const idx = Number(n);
    return [
      privateState,
      (idx >= 0 && idx < setup.roleCommitments.length)
        ? setup.roleCommitments[idx]
        : new Uint8Array(0),
    ];
  },
  // Returns Encrypted Roles
  wit_getEncryptedRole: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    _gid: any,
    n: any,
  ) => {
    const setup = privateState.activeActor!.getSetupData!();
    const idx = Number(n);
    return [
      privateState,
      (idx >= 0 && idx < setup.encryptedRoles.length)
        ? setup.encryptedRoles[idx]
        : new Uint8Array(3),
    ];
  },
  // Returns Admin Auth Key (for state.adminKey)
  wit_getAdminKey: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
  ) => {
    return [
      privateState,
      privateState.activeActor!.getSetupData!().adminAuthKey,
    ];
  },
  // Returns Merkle Root
  wit_getInitialRoot: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
  ) => {
    return [
      privateState,
      privateState.activeActor!.getSetupData!().initialRoot,
    ];
  },
  // Returns Action Data (Encryption uses adminEncKey)
  wit_getActionData: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    _gid: any,
    round: bigint,
  ) => {
    return [privateState, privateState.activeActor!.getActionData!(round)];
  },
};

class Simulation {
  contract: Contract;
  context: CircuitContext<PrivateState>;
  gameId: bigint;
  admin: TrustedNode;
  players: Player[];

  constructor() {
    this.contract = new Contract(witnesses);
    this.gameId = BigInt(Math.floor(Math.random() * 0xFFFFFFFF));
    this.admin = new TrustedNode();
    this.players = Array.from({ length: 15 }, (_, i) => new Player(i));

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext({}, "0".repeat(64)),
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
  }

  async runCircuit<T>(
    fn: () => { context: CircuitContext<PrivateState>; result: T },
  ): Promise<T> {
    const res = fn();
    this.context = res.context;
    return res.result;
  }

  async run() {
    console.log("🐺 STARTING WEREWOLF SIMULATION");
    const { circuits } = this.contract;

    // --- SETUP ---
    // 1. Get Simulator's default Identity Key (to be used as Admin Auth Key)
    const simulatorIdentity = await this.runCircuit(() =>
      circuits.getAdminKey(this.context)
    );
    // 2. Set it in Admin
    this.admin.setAuthKey(simulatorIdentity.bytes);

    const commitments: Uint8Array[] = [];
    const leafHashes: Uint8Array[] = [];

    for (const p of this.players) {
      const hash = await this.runCircuit(() =>
        circuits.testComputeHash(this.context, p.leafSecret)
      );
      p.leafHash = hash;
      leafHashes.push(hash);

      const salt = await this.runCircuit(() =>
        circuits.testComputeSalt(this.context, new Uint8Array(32), BigInt(p.id))
      );
      const role = p.id === 0 ? Role.Werewolf : Role.Villager;
      const comm = await this.runCircuit(() =>
        circuits.testComputeCommitment(this.context, BigInt(role), salt)
      );
      commitments.push(comm);

      this.admin.registerPlayerKeys(p.id, p.encKeypair.publicKey, role);
      // Give players the Admin's ENCRYPTION Key, not Auth Key
      p.receiveGameConfig(role, this.admin.adminEncKey, this.players.length);
    }
    this.admin.setCommitments(commitments);

    console.log("Building Merkle Tree...");
    const tree = new RuntimeMerkleTree(this, leafHashes);
    await tree.build();
    const root = tree.getRoot();
    this.admin.setInitialRoot(root);

    this.players.forEach((p, i) =>
      p.merklePath = tree.getProof(i, p.leafHash!)
    );

    // --- CREATE GAME ON-CHAIN ---
    this.context.currentPrivateState.activeActor = this.admin;
    const masterCommit = await this.runCircuit(() =>
      circuits.testComputeHash(this.context, new Uint8Array(32))
    );

    // Pass the Admin Encryption Key (33 bytes expected, pad if 32)
    const adminVotePubKeyPadded = new Uint8Array(33);
    adminVotePubKeyPadded.set(this.admin.adminEncKey);

    await this.runCircuit(() =>
      circuits.createGame(
        this.context,
        this.gameId,
        adminVotePubKeyPadded,
        masterCommit,
        BigInt(this.players.length),
        1n,
      )
    );
    console.log("✅ Game Created");

    // --- GAME LOOP ---
    let round = 1;
    let gameOver = false;

    const checkWinCondition = () => {
      const alivePlayers = this.players.filter((p) => p.isAlive);
      const wolves =
        alivePlayers.filter((p) => p.role === Role.Werewolf).length;
      const villagers = alivePlayers.length - wolves;
      if (wolves === 0) return "villagers";
      if (wolves >= villagers) return "werewolves";
      return null;
    };

    while (!gameOver) {
      // --- NIGHT PHASE ---
      console.log(`\n🌙 --- Round ${round}: Night ---`);

      for (const p of this.players) {
        if (!p.isAlive) continue;
        this.context.currentPrivateState.activeActor = p;
        try {
          await this.runCircuit(() =>
            circuits.nightAction(this.context, this.gameId)
          );
        } catch (e) {
          console.error(`P${p.id} failed to vote:`, e);
        }
      }

      this.context.currentPrivateState.activeActor = this.admin;
      const nightVotes = await this.runCircuit(() =>
        circuits.getEncryptedVotesForRound(
          this.context,
          this.gameId,
          Phase.Night,
          BigInt(round),
        )
      );

      const nightRes = this.admin.processVotesFromLedger(
        nightVotes as Uint8Array[],
        round,
        true,
      );

      // Resolve Night - Authorizes with Auth Key (PK_SIM)
      await this.runCircuit(() =>
        circuits.resolveNightPhase(
          this.context,
          this.gameId,
          BigInt(round + 1),
          BigInt(nightRes.eliminatedIdx),
          nightRes.hasElimination,
          root,
        )
      );

      if (nightRes.hasElimination) {
        if (this.players[nightRes.eliminatedIdx]) {
          this.players[nightRes.eliminatedIdx].isAlive = false;
          this.players.forEach((p) =>
            p.updateAliveStatus(nightRes.eliminatedIdx)
          );
          console.log(`    💀 P${nightRes.eliminatedIdx} was killed!`);
        } else {
          console.error(
            `    ❌ Error: Invalid player index eliminated: ${nightRes.eliminatedIdx}`,
          );
        }
      } else {
        console.log(`    😮 No death.`);
      }

      if (checkWinCondition()) {
        gameOver = true;
        break;
      }

      // --- DAY PHASE ---
      console.log(`\n☀️  --- Round ${round}: Day ---`);

      for (const p of this.players) {
        if (!p.isAlive) continue;
        this.context.currentPrivateState.activeActor = p;
        await this.runCircuit(() =>
          circuits.voteDay(this.context, this.gameId)
        );
      }

      const dayVotes = await this.runCircuit(() =>
        circuits.getEncryptedVotesForRound(
          this.context,
          this.gameId,
          Phase.Day,
          BigInt(round),
        )
      );

      const dayRes = this.admin.processVotesFromLedger(
        dayVotes as Uint8Array[],
        round,
        false,
      );

      await this.runCircuit(() =>
        circuits.resolveDayPhase(
          this.context,
          this.gameId,
          BigInt(dayRes.eliminatedIdx),
          dayRes.hasElimination,
        )
      );

      if (dayRes.hasElimination) {
        if (this.players[dayRes.eliminatedIdx]) {
          this.players[dayRes.eliminatedIdx].isAlive = false;
          this.players.forEach((p) =>
            p.updateAliveStatus(dayRes.eliminatedIdx)
          );
          console.log(`    🔥 P${dayRes.eliminatedIdx} executed!`);
        } else {
          console.error(
            `    ❌ Error: Invalid player index executed: ${dayRes.eliminatedIdx}`,
          );
        }
      } else {
        console.log(`    🤷 No execution.`);
      }

      if (checkWinCondition()) {
        gameOver = true;
      }
      round++;
    }

    console.log(`\n🏆 Winner: ${checkWinCondition()?.toUpperCase()}`);
  }
}

new Simulation().run().catch(console.error);
