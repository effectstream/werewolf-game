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
import { decrypt, encrypt, PrivateKey } from "eciesjs";
import { Contract } from "../src/managed/contract/index.js";

// =============================================================================
// 1. TYPES
// =============================================================================

export const Role = { Villager: 0, Werewolf: 1, Seer: 2, Doctor: 3 };
export const Phase = { Lobby: 0, Night: 1, Day: 2, Finished: 3 };

type MerkleTreeDigest = { field: bigint };
type MerkleTreePathEntry = { sibling: MerkleTreeDigest; goes_left: boolean };
type MerkleTreePath = { leaf: Uint8Array; path: MerkleTreePathEntry[] };

type SetupData = { roleCommitments: Uint8Array[] };
type ActionData = {
  encryptedAction: Uint8Array;
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array;
};

type PrivateState = {
  activeActor?: Actor;
  currentRound?: bigint;
};

type Ledger = any;

// =============================================================================
// 2. ACTORS
// =============================================================================

interface Actor {
  getSetupData?(): SetupData;
  getActionData?(round: bigint): ActionData;
}

class Player implements Actor {
  readonly id: number;
  readonly leafSecret: Uint8Array;

  // These will be calculated by the simulation runner using contract circuits
  leafHash?: Uint8Array;
  merklePath?: MerkleTreePath;

  role: number = Role.Villager;
  adminVotePubKey?: string;
  isAlive: boolean = true;

  // Reference to all players for AI voting decisions
  allPlayers?: Player[];

  constructor(id: number) {
    this.id = id;
    this.leafSecret = new Uint8Array(
      createHash("sha256").update(`p${id}_${Math.random()}`).digest(),
    );
  }

  receiveGameConfig(
    role: number,
    adminVotePubKey: string,
    allPlayers: Player[],
  ) {
    this.role = role;
    this.adminVotePubKey = adminVotePubKey;
    this.allPlayers = allPlayers;
  }

  getActionData(round: bigint): ActionData {
    if (!this.adminVotePubKey) throw new Error(`P${this.id}: No Admin PubKey`);
    if (!this.merklePath) throw new Error(`P${this.id}: No Merkle Path`);
    if (!this.allPlayers) throw new Error(`P${this.id}: No player list`);

    const targetIdx = this.chooseTarget();

    const payload = new Uint8Array(32);
    new DataView(payload.buffer).setUint32(0, targetIdx, true);
    const encryptedBuffer = encrypt(this.adminVotePubKey, Buffer.from(payload));

    const roleEmoji = this.role === Role.Werewolf ? "🐺" : "👤";
    console.log(`    ${roleEmoji} P${this.id} votes for P${targetIdx}`);

    return {
      encryptedAction: new Uint8Array(encryptedBuffer),
      merklePath: this.merklePath,
      leafSecret: this.leafSecret,
    };
  }

  private chooseTarget(): number {
    const alivePlayers = this.allPlayers!.filter((p) =>
      p.isAlive && p.id !== this.id
    );

    if (alivePlayers.length === 0) {
      // Fallback: vote for self (shouldn't happen)
      return this.id;
    }

    if (this.role === Role.Werewolf) {
      // Werewolves know each other and target villagers
      const villagers = alivePlayers.filter((p) => p.role !== Role.Werewolf);
      if (villagers.length > 0) {
        // Target a random villager
        return villagers[Math.floor(Math.random() * villagers.length)].id;
      }
      // No villagers left, vote for another wolf (game should be over)
      return alivePlayers[Math.floor(Math.random() * alivePlayers.length)].id;
    } else {
      // Villagers don't know roles, vote randomly among alive players
      return alivePlayers[Math.floor(Math.random() * alivePlayers.length)].id;
    }
  }
}

class TrustedNode implements Actor {
  public adminKey: Uint8Array;
  private masterSecret: Uint8Array;
  private votePrivKey: PrivateKey;
  readonly votePubKeyHex: string;
  readonly votePubKeyBytes: Uint8Array;

  // Track player data to provide Setup Witness
  private commitments: Uint8Array[] = [];

  constructor() {
    this.masterSecret = new Uint8Array(
      createHash("sha256").update("master").digest(),
    );
    this.adminKey = new Uint8Array(32).fill(1);
    this.votePrivKey = new PrivateKey();
    this.votePubKeyHex = this.votePrivKey.publicKey.toHex();
    this.votePubKeyBytes = Uint8Array.from(
      Buffer.from(this.votePubKeyHex, "hex"),
    );
  }

  setCommitments(commits: Uint8Array[]) {
    this.commitments = commits;
  }

  getSetupData(): SetupData {
    // Pad to 10
    const padded = [...this.commitments];
    while (padded.length < 10) padded.push(new Uint8Array(32));
    return { roleCommitments: padded };
  }

  processVotes(
    encryptedVotes: Uint8Array[],
    isNightPhase: boolean,
    werewolfIndices?: number[], // Indices of werewolf players (for filtering night votes)
  ): { eliminatedIdx: number; hasElimination: boolean } {
    const votes = new Map<number, number>();

    // During night, only count votes from werewolves
    // The vote array is indexed by player ID, so we can filter
    for (let i = 0; i < encryptedVotes.length; i++) {
      const enc = encryptedVotes[i];
      if (enc.every((b) => b === 0)) continue;

      // During night phase, skip non-werewolf votes
      if (isNightPhase && werewolfIndices && !werewolfIndices.includes(i)) {
        continue;
      }

      try {
        const dec = decrypt(this.votePrivKey.toHex(), Buffer.from(enc));
        const target = new DataView(dec.buffer).getUint32(0, true);
        votes.set(target, (votes.get(target) || 0) + 1);
      } catch (e) {}
    }

    // Find max votes and all players with that vote count
    let maxVotes = 0;
    votes.forEach((count) => {
      if (count > maxVotes) maxVotes = count;
    });

    // Get all players tied for first place
    const tiedPlayers: number[] = [];
    votes.forEach((count, playerId) => {
      if (count === maxVotes) tiedPlayers.push(playerId);
    });

    if (tiedPlayers.length === 0 || maxVotes === 0) {
      // Return 0 as placeholder index (hasElimination=false means it won't be used)
      return { eliminatedIdx: 0, hasElimination: false };
    }

    let target: number;
    let hasElimination: boolean;

    if (tiedPlayers.length > 1) {
      // There's a tie for first place
      if (isNightPhase) {
        // Night: randomly select one of the tied players
        const randomIdx = Math.floor(Math.random() * tiedPlayers.length);
        target = tiedPlayers[randomIdx];
        hasElimination = true;
        console.log(
          `    [Node] Night tie! Randomly eliminating P${target} from tied players: ${
            tiedPlayers.map((p) => `P${p}`).join(", ")
          }`,
        );
      } else {
        // Day: no elimination on tie
        console.log(
          `    [Node] Day vote tie! No elimination. Tied players: ${
            tiedPlayers.map((p) => `P${p}`).join(", ")
          }`,
        );
        // Return 0 as placeholder index (hasElimination=false means it won't be used)
        return { eliminatedIdx: 0, hasElimination: false };
      }
    } else {
      // Clear winner
      target = tiedPlayers[0];
      hasElimination = true;
      console.log(`    [Node] Consensus: Eliminate P${target}`);
    }

    return { eliminatedIdx: target, hasElimination };
  }
}

// =============================================================================
// 3. RUNTIME MERKLE TREE
// =============================================================================

class RuntimeMerkleTree {
  private leaves: Uint8Array[];
  private levels: MerkleTreeDigest[][] = []; // Store FULL digests
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

    // Compute digest for zero/padding leaf using testLeafDigest (Bytes->Digest)
    const zeroLeafDigest = await this.simulation.runCircuit(
      () =>
        this.simulation.contract.circuits.testLeafDigest(
          this.simulation.context,
          zeroBytes,
        ),
    );

    for (let i = 0; i < totalLeaves; i++) {
      if (i < this.leaves.length) {
        const digest = await this.simulation.runCircuit(
          () =>
            this.simulation.contract.circuits.testLeafDigest(
              this.simulation.context,
              this.leaves[i],
            ),
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
        // Hash digests using testNodeDigest (Digest, Digest -> Digest)
        const parent = await this.simulation.runCircuit(
          () =>
            this.simulation.contract.circuits.testNodeDigest(
              this.simulation.context,
              left,
              right,
            ),
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
        // goes_left = true means current node goes on LEFT in hash(left, right)
        // If current is a left child (index even), it goes on the left
        goes_left: !isRight,
      });
      idx = Math.floor(idx / 2);
    }
    return { leaf, path };
  }
}

// =============================================================================
// 4. SIMULATION RUNNER
// =============================================================================

const witnesses = {
  wit_getRoleCommitment: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    _gameId: Uint8Array,
    n: number | bigint,
  ) => {
    if (!privateState.activeActor?.getSetupData) {
      throw new Error("No setup data");
    }
    const setup = privateState.activeActor.getSetupData();
    const index = Number(n);
    if (index < 0 || index >= setup.roleCommitments.length) {
      throw new Error(`Role commitment index ${index} out of bounds`);
    }
    return [privateState, setup.roleCommitments[index]];
  },
  wit_getActionData: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    _gameId: Uint8Array,
    round: bigint,
  ) => {
    if (!privateState.activeActor?.getActionData) {
      throw new Error("No action data");
    }
    return [privateState, privateState.activeActor.getActionData(round)];
  },
};

class Simulation {
  contract: Contract;
  context: CircuitContext<PrivateState>;
  gameId: Uint8Array;
  admin: TrustedNode;
  players: Player[];

  constructor() {
    this.contract = new Contract(witnesses);
    this.gameId = new Uint8Array(32).fill(9);
    this.admin = new TrustedNode();
    this.players = Array.from({ length: 5 }, (_, i) => new Player(i));

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
    const adminKeyRes = await this.runCircuit(() =>
      circuits.getAdminKey(this.context)
    );
    this.admin.adminKey = adminKeyRes.bytes;

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
      const comm = await this.runCircuit(() =>
        circuits.testComputeCommitment(
          this.context,
          BigInt(p.id === 0 ? 1 : 0),
          salt,
        )
      );
      commitments.push(comm);

      p.receiveGameConfig(
        p.id === 0 ? Role.Werewolf : Role.Villager,
        this.admin.votePubKeyHex,
        this.players,
      );
    }
    this.admin.setCommitments(commitments);

    console.log("Building Merkle Tree...");
    const tree = new RuntimeMerkleTree(this, leafHashes);
    await tree.build();
    const root = tree.getRoot();
    console.log("Tree Root:", root.field);

    this.players.forEach((p, i) =>
      p.merklePath = tree.getProof(i, p.leafHash!)
    );

    console.log("Verifying Player Proofs...");
    for (const p of this.players) {
      const valid = await this.runCircuit(() =>
        circuits.testVerifyMerkleProof(
          this.context,
          root,
          p.leafHash!,
          p.merklePath!,
        )
      );
      if (!valid) throw new Error(`Proof invalid for player ${p.id}`);
    }
    console.log("✅ Proofs verified");

    // --- CREATE GAME ---
    this.context.currentPrivateState.activeActor = this.admin;
    const masterCommit = await this.runCircuit(() =>
      circuits.testComputeHash(this.context, new Uint8Array(32))
    );

    await this.runCircuit(() =>
      circuits.createGame(
        this.context,
        this.gameId,
        { bytes: this.admin.adminKey },
        this.admin.votePubKeyBytes,
        masterCommit,
        BigInt(this.players.length),
        1n,
        root,
      )
    );
    console.log("✅ Game Created");

    // --- GAME LOOP ---
    let round = 1;
    let gameOver = false;
    let winner: "werewolves" | "villagers" | null = null;

    const checkWinCondition = (): {
      gameOver: boolean;
      winner: "werewolves" | "villagers" | null;
    } => {
      const alivePlayers = this.players.filter((p) => p.isAlive);
      const aliveWerewolves = alivePlayers.filter((p) =>
        p.role === Role.Werewolf
      );
      const aliveVillagers = alivePlayers.filter((p) =>
        p.role !== Role.Werewolf
      );

      if (aliveWerewolves.length === 0) {
        return { gameOver: true, winner: "villagers" };
      }
      if (aliveWerewolves.length >= aliveVillagers.length) {
        return { gameOver: true, winner: "werewolves" };
      }
      return { gameOver: false, winner: null };
    };

    const printStatus = () => {
      const alive = this.players.filter((p) => p.isAlive);
      const wolves = alive.filter((p) => p.role === Role.Werewolf).length;
      const villagers = alive.length - wolves;
      console.log(
        `    📊 Status: ${alive.length} alive (🐺 ${wolves} werewolves, 👤 ${villagers} villagers)`,
      );
    };

    while (!gameOver) {
      // --- NIGHT PHASE ---
      console.log(`\n🌙 --- Round ${round}: Night ---`);
      // All players vote at night (for privacy - hides werewolf count)
      // But only werewolf votes actually count
      for (const p of this.players) {
        if (!p.isAlive) continue;
        this.context.currentPrivateState.activeActor = p;
        await this.runCircuit(() =>
          circuits.nightAction(this.context, this.gameId)
        );
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
      // Only count werewolf votes at night
      const werewolfIndices = this.players
        .filter((p) => p.role === Role.Werewolf)
        .map((p) => p.id);
      const nightRes = this.admin.processVotes(
        nightVotes as Uint8Array[],
        true,
        werewolfIndices,
      );

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
        const victim = this.players[nightRes.eliminatedIdx];
        victim.isAlive = false;
        const roleStr = victim.role === Role.Werewolf
          ? "🐺 Werewolf"
          : "👤 Villager";
        console.log(
          `    💀 P${nightRes.eliminatedIdx} (${roleStr}) was killed in the night!`,
        );
      } else {
        console.log(`    😮 No one died tonight!`);
      }

      printStatus();

      // Check win condition after night
      ({ gameOver, winner } = checkWinCondition());
      if (gameOver) break;

      // --- DAY PHASE ---
      console.log(`\n☀️  --- Round ${round}: Day ---`);
      for (const p of this.players) {
        if (!p.isAlive) continue;
        this.context.currentPrivateState.activeActor = p;
        await this.runCircuit(() =>
          circuits.voteDay(this.context, this.gameId)
        );
      }

      this.context.currentPrivateState.activeActor = this.admin;
      const dayVotes = await this.runCircuit(() =>
        circuits.getEncryptedVotesForRound(
          this.context,
          this.gameId,
          Phase.Day,
          BigInt(round),
        )
      );
      const dayRes = this.admin.processVotes(dayVotes as Uint8Array[], false);

      await this.runCircuit(() =>
        circuits.resolveDayPhase(
          this.context,
          this.gameId,
          BigInt(dayRes.eliminatedIdx),
          dayRes.hasElimination,
        )
      );

      if (dayRes.hasElimination) {
        const victim = this.players[dayRes.eliminatedIdx];
        victim.isAlive = false;
        const roleStr = victim.role === Role.Werewolf
          ? "🐺 Werewolf"
          : "👤 Villager";
        console.log(
          `    🔥 P${dayRes.eliminatedIdx} (${roleStr}) was executed by the village!`,
        );
      } else {
        console.log(`    🤷 The village couldn't decide. No one was executed.`);
      }

      printStatus();

      // Check win condition after day
      ({ gameOver, winner } = checkWinCondition());
      round++;
    }

    // --- GAME OVER ---
    console.log("\n" + "=".repeat(50));
    if (winner === "werewolves") {
      console.log("🐺🐺🐺 WEREWOLVES WIN! 🐺🐺🐺");
      console.log("The werewolves have taken over the village!");
    } else {
      console.log("👤👤👤 VILLAGERS WIN! 👤👤👤");
      console.log("The village has eliminated all werewolves!");
    }
    console.log("=".repeat(50));

    // Print final player status
    console.log("\n📋 Final Player Status:");
    for (const p of this.players) {
      const roleStr = p.role === Role.Werewolf ? "🐺 Werewolf" : "👤 Villager";
      const statusStr = p.isAlive ? "✅ Alive" : "💀 Dead";
      console.log(`    P${p.id}: ${roleStr} - ${statusStr}`);
    }

    console.log("\n🏁 Simulation Complete");
  }
}

new Simulation().run().catch(console.error);
