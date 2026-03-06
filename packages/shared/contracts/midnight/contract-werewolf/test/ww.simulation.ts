import {
  type CircuitContext,
  CostModel,
  createConstructorContext,
  QueryContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract } from "../src/managed/contract/index.js";
import { Player, Role, type WitnessSet } from "./simulation-player.ts";
import {
  buildAliveTree,
  buildInitialTree,
  type MerkleCircuitRunner,
  TrustedNode,
} from "./simulation-trusted-node.ts";

// =============================================================================
// 1. TYPES (orchestration only)
// =============================================================================

export { Role };
export const Phase = { Lobby: 0, Night: 1, Day: 2, Finished: 3 };

type PrivateState = Record<string, unknown>;

type Ledger = any;

// =============================================================================
// 2. PER-ACTOR WITNESS WRAPPER (default throws; actors set/unset their witness)
// =============================================================================

const DEFAULT_WITNESS_MSG =
  "Default witness must not be called; set current actor's witness before running circuits.";

/** Registry that delegates to the currently set witness; default (none set) throws. */
export class WitnessRegistry {
  private current: WitnessSet<PrivateState, Ledger> | null = null;

  setCurrent(witness: WitnessSet<PrivateState, Ledger>): void {
    this.current = witness;
  }

  unsetCurrent(): void {
    this.current = null;
  }

  getCurrent(): WitnessSet<PrivateState, Ledger> | null {
    return this.current;
  }

  /** Returns the witness object to pass to the Contract; delegates to current or throws. */
  getWitnesses(): WitnessSet<PrivateState, Ledger> {
    const self = this;
    return {
      wit_getRoleCommitment(ctx, gid, n) {
        const w = self.getCurrent();
        if (!w) throw new Error(DEFAULT_WITNESS_MSG);
        return w.wit_getRoleCommitment(ctx, gid, n);
      },
      wit_getEncryptedRole(ctx, gid, n) {
        const w = self.getCurrent();
        if (!w) throw new Error(DEFAULT_WITNESS_MSG);
        return w.wit_getEncryptedRole(ctx, gid, n);
      },
      wit_getInitialRoot(ctx, gid) {
        const w = self.getCurrent();
        if (!w) throw new Error(DEFAULT_WITNESS_MSG);
        return w.wit_getInitialRoot(ctx, gid);
      },
      wit_getActionData(ctx, gid, round) {
        const w = self.getCurrent();
        if (!w) throw new Error(DEFAULT_WITNESS_MSG);
        return w.wit_getActionData(ctx, gid, round);
      },
    };
  }
}

class Simulation {
  contract: Contract;
  context: CircuitContext<PrivateState>;
  gameId: bigint;
  admin: TrustedNode;
  players: Player[];
  witnessRegistry: WitnessRegistry;

  constructor() {
    this.witnessRegistry = new WitnessRegistry();
    this.contract = new Contract(this.witnessRegistry.getWitnesses());
    this.gameId = BigInt(Math.floor(Math.random() * 0xFFFFFFFF));
    this.admin = new TrustedNode();
    this.players = Array.from({ length: 14 }, (_, i) => new Player(i));

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
    console.log("gameId", this);
    const { circuits } = this.contract;

    // --- SETUP ---
    // Admin auth key is only stored in state (from witness at createGame); no circuit or
    // check depends on the admin private key.
    // this.admin.setAuthKey(new Uint8Array(32));

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
    const runner: MerkleCircuitRunner<CircuitContext<PrivateState>> = {
      runCircuit: this.runCircuit.bind(this),
      contract: this.contract,
      context: this.context,
    };
    const tree = await buildInitialTree(runner, leafHashes);
    const root = tree.getRoot();
    this.admin.setInitialRoot(root);

    this.players.forEach((p, i) =>
      p.merklePath = tree.getProof(i, p.leafHash!)
    );

    // --- CREATE GAME ON-CHAIN ---
    this.witnessRegistry.setCurrent(
      this.admin.getWitness<PrivateState, Ledger>(),
    );
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
    this.witnessRegistry.unsetCurrent();
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
        this.witnessRegistry.setCurrent(p.getWitness<PrivateState, Ledger>());
        try {
          await this.runCircuit(() =>
            circuits.nightAction(this.context, this.gameId)
          );
        } catch (e) {
          console.error(`P${p.id} failed to vote:`, e);
        }
        this.witnessRegistry.unsetCurrent();
      }

      this.witnessRegistry.setCurrent(
        this.admin.getWitness<PrivateState, Ledger>(),
      );
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

      // Consistency: root must reflect alive set after this night (contract verifies proofs against it next round)
      const aliveAfterNight = new Set(
        this.players.filter((p) => p.isAlive).map((p) => p.id),
      );
      if (nightRes.hasElimination) {
        aliveAfterNight.delete(nightRes.eliminatedIdx);
      }
      const contextBeforeTree = this.context;
      const nightTree = await buildAliveTree(
        runner,
        this.players,
        aliveAfterNight,
      );
      const nightRoot = nightTree.getRoot();
      this.context = contextBeforeTree;

      await this.runCircuit(() =>
        circuits.resolveNightPhase(
          this.context,
          this.gameId,
          BigInt(round + 1),
          BigInt(nightRes.eliminatedIdx),
          nightRes.hasElimination,
          nightRoot,
        )
      );
      this.witnessRegistry.unsetCurrent();

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

      // Update Merkle paths for next round (proofs must match new root)
      for (const p of this.players) {
        if (p.isAlive && p.leafHash) {
          p.merklePath = nightTree.getProof(p.id, p.leafHash);
        }
      }

      if (checkWinCondition()) {
        gameOver = true;
        break;
      }

      // --- DAY PHASE ---
      console.log(`\n☀️  --- Round ${round}: Day ---`);

      for (const p of this.players) {
        if (!p.isAlive) continue;
        this.witnessRegistry.setCurrent(p.getWitness<PrivateState, Ledger>());
        await this.runCircuit(() =>
          circuits.voteDay(this.context, this.gameId)
        );
        this.witnessRegistry.unsetCurrent();
      }

      this.witnessRegistry.setCurrent(
        this.admin.getWitness<PrivateState, Ledger>(),
      );
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
      this.witnessRegistry.unsetCurrent();

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
