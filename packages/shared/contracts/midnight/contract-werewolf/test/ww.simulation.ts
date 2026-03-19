import {
  type CircuitContext,
  CostModel,
  createConstructorContext,
  QueryContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, Phase as ContractPhase } from "../src/managed/contract/index.js";
import { Player, Role, type WitnessSet } from "./simulation-player.ts";
import {
  type MerkleCircuitRunner,
  TrustedNode,
} from "./simulation-trusted-node.ts";
import { computeRoundActionsDigest } from "../../../../utils/round-actions-digest.ts";

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

    const leafHashes: Uint8Array[] = [];

    // Player execution pre-game
    for (const p of this.players) {
      const hash = await p.preGameSetup((secret) =>
        this.runCircuit(() => circuits.testComputeHash(this.context, secret))
      );
      leafHashes.push(hash);
    }

    // Trusted Node execution pre-game
    const runner = {
      runCircuit: this.runCircuit.bind(this),
      contract: this.contract,
      context: this.context,
    };

    const { roles, tree } = await this.admin.preGameSetup(
      runner,
      this.players.map((p) => ({
        id: p.id,
        pubKey: p.encKeypair.publicKey,
        leafHash: p.leafHash!,
      })),
    );

    // Distribute roles to players
    for (const [i, p] of this.players.entries()) {
      p.receiveGameConfig(
        roles[i],
        this.admin.adminEncKey,
        this.players.length,
      );
    }

    // Admin write merkle paths to players
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

    const adminVotePubKeyPadded = new Uint8Array(33);
    adminVotePubKeyPadded.set(this.admin.adminEncKey);

    await this.runCircuit(() =>
      circuits.createGame(
        this.context,
        this.gameId,
        adminVotePubKeyPadded,
        masterCommit,
        BigInt(this.players.length),
        BigInt(roles.filter((r) => r === Role.Werewolf).length),
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
          console.error(`P${p.id} failed night action:`, e);
        }
        this.witnessRegistry.unsetCurrent();
      }

      // Admin reads all night votes by iterating the ledger map directly — no circuits, no external state.
      this.witnessRegistry.setCurrent(
        this.admin.getWitness<PrivateState, Ledger>(),
      );
      const nightVoteEntries: { nullifier: Uint8Array; encryptedAction: Uint8Array }[] = [];
      const ledgerState = ledger(this.context.currentQueryContext.state);
      for (const [key, vote] of ledgerState.Werewolf_roundVotes) {
        if (
          key.gameId === this.gameId &&
          key.phase === ContractPhase.Night &&
          key.round === BigInt(round)
        ) {
          nightVoteEntries.push({
            nullifier: key.nullifier,
            encryptedAction: vote,
          });
        }
      }

      const nightRes = this.admin.processVotesFromLedger(
        nightVoteEntries.map((entry) => entry.encryptedAction),
        round,
        true,
      );
      const nightRoundDigest = computeRoundActionsDigest(
        this.gameId,
        round,
        ContractPhase.Night,
        nightVoteEntries,
      );

      const contextBeforeTree = this.context;
      const { root: nightRoot, tree: nightTree } = await this.admin
        .processNightElimination(
          runner,
          nightRes.eliminatedIdx,
          nightRes.hasElimination,
        );
      this.context = contextBeforeTree;

      await this.runCircuit(() =>
        circuits.resolveNightPhase(
          this.context,
          this.gameId,
          BigInt(round + 1),
          BigInt(nightRes.eliminatedIdx),
          nightRes.hasElimination,
          nightRoot,
          nightRoundDigest,
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
        try {
          await this.runCircuit(() =>
            circuits.voteDay(this.context, this.gameId)
          );
        } catch (e) {
          console.error(`P${p.id} failed day vote:`, e);
        }
        this.witnessRegistry.unsetCurrent();
      }

      this.witnessRegistry.setCurrent(
        this.admin.getWitness<PrivateState, Ledger>(),
      );
      const dayVoteEntries: { nullifier: Uint8Array; encryptedAction: Uint8Array }[] = [];
      const ledgerStateDay = ledger(this.context.currentQueryContext.state);
      for (const [key, vote] of ledgerStateDay.Werewolf_roundVotes) {
        if (
          key.gameId === this.gameId &&
          key.phase === ContractPhase.Day &&
          key.round === BigInt(round)
        ) {
          dayVoteEntries.push({
            nullifier: key.nullifier,
            encryptedAction: vote,
          });
        }
      }

      const dayRes = this.admin.processVotesFromLedger(
        dayVoteEntries.map((entry) => entry.encryptedAction),
        round,
        false,
      );
      const dayRoundDigest = computeRoundActionsDigest(
        this.gameId,
        round,
        ContractPhase.Day,
        dayVoteEntries,
      );

      await this.runCircuit(() =>
        circuits.resolveDayPhase(
          this.context,
          this.gameId,
          BigInt(dayRes.eliminatedIdx),
          dayRes.hasElimination,
          dayRoundDigest,
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
