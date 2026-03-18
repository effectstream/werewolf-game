import type { WerewolfLedger } from "./werewolf-ledger.ts";

// ---------------------------------------------------------------------------
// GameView — pure value object for a single game's ledger snapshot
// ---------------------------------------------------------------------------

/**
 * GameView
 *
 * A fully-resolved, immutable snapshot of one game's on-chain state.
 * All fields are computed eagerly from the ledger at construction time;
 * the `WerewolfLedger` reference is not retained after `from()` returns.
 *
 * Key invariants:
 *  - `aliveIndices` / `aliveCount` are "effective": when the ledger hasn't
 *    propagated alive flags yet (empty but game not finished), every player
 *    slot is treated as alive.
 *  - `aliveVector` uses the raw (pre-effective) list for its per-slot
 *    `.includes` check, mirroring the original STF behaviour.
 *  - `phase` is always the normalized canonical string ("NIGHT"/"DAY"/"FINISHED")
 *    and is safe to write directly to any DB column.
 */
export class GameView {
  readonly gameId: number;
  readonly round: number;
  readonly phase: "NIGHT" | "DAY" | "FINISHED";
  readonly isFinished: boolean;
  /** Who won the game, or null while the game is still in progress. */
  readonly winner: "VILLAGERS" | "WEREWOLVES" | "DRAW" | null;
  readonly playerCount: number;
  /** Effective alive indices (includes all slots when useAllAlive applies). */
  readonly aliveIndices: readonly number[];
  /** Length of aliveIndices. */
  readonly aliveCount: number;
  /** Set view of aliveIndices for O(1) membership checks. */
  readonly aliveSet: ReadonlySet<number>;
  /**
   * Per-slot alive vector of length playerCount.
   * Built from the raw on-chain alive list (not the effective list), so
   * when useAllAlive is active every entry is unconditionally true.
   */
  readonly aliveVector: readonly boolean[];
  readonly werewolfCount: number;
  readonly villagerCount: number;
  /** Round number of the phase that immediately preceded the current one. */
  readonly prevRound: number;
  /** Phase of the phase that immediately preceded the current one. */
  readonly prevPhase: "NIGHT" | "DAY";

  private constructor(fields: {
    gameId: number;
    round: number;
    phase: "NIGHT" | "DAY" | "FINISHED";
    isFinished: boolean;
    winner: "VILLAGERS" | "WEREWOLVES" | "DRAW" | null;
    playerCount: number;
    aliveIndices: readonly number[];
    aliveCount: number;
    aliveSet: ReadonlySet<number>;
    aliveVector: readonly boolean[];
    werewolfCount: number;
    villagerCount: number;
    prevRound: number;
    prevPhase: "NIGHT" | "DAY";
  }) {
    this.gameId = fields.gameId;
    this.round = fields.round;
    this.phase = fields.phase;
    this.isFinished = fields.isFinished;
    this.winner = fields.winner;
    this.playerCount = fields.playerCount;
    this.aliveIndices = fields.aliveIndices;
    this.aliveCount = fields.aliveCount;
    this.aliveSet = fields.aliveSet;
    this.aliveVector = fields.aliveVector;
    this.werewolfCount = fields.werewolfCount;
    this.villagerCount = fields.villagerCount;
    this.prevRound = fields.prevRound;
    this.prevPhase = fields.prevPhase;
  }

  /**
   * Build a GameView from a WerewolfLedger for the given gameId.
   *
   * If the game is not present in the ledger, returns a zero-value sentinel
   * (playerCount = 0, aliveCount = 0). The STF's `aliveCount === 0` guard
   * will skip it naturally; `isValid()` will also return false.
   */
  static from(ledger: WerewolfLedger, gameId: number): GameView {
    const game = ledger.getGame(gameId);
    const phase = ledger.phaseString(gameId);
    const isFinished = phase === "FINISHED";
    const playerCount = Number(game?.playerCount ?? 0);
    const werewolfCount = Number(game?.werewolfCount ?? 0);
    const villagerCount = Number(game?.villagerCount ?? 0);
    const round = ledger.getRound(gameId);

    // Raw alive indices directly from the ledger (before effective fallback).
    const rawAliveIndices = ledger.aliveIndices(gameId);
    const rawAliveCount = rawAliveIndices.length;

    // When aliveCount is 0 but the game hasn't finished and playerCount > 0,
    // the ledger snapshot is ambiguous (alive flags not yet propagated).
    // Default every slot to alive so the frontend never shows all players dead
    // before the game has actually started. Mirrors STF lines 105-109.
    const useAllAlive = !isFinished && rawAliveCount === 0 && playerCount > 0;

    const aliveIndices: number[] = useAllAlive
      ? Array.from({ length: playerCount }, (_, i) => i)
      : rawAliveIndices;

    const aliveCount = aliveIndices.length;
    const aliveSet: ReadonlySet<number> = new Set(aliveIndices);

    // aliveVector uses rawAliveIndices for the .includes check (not the
    // effective list), matching the original STF behaviour exactly.
    const aliveVector: boolean[] = Array.from(
      { length: playerCount },
      (_, i) => useAllAlive ? true : rawAliveIndices.includes(i),
    );

    const { round: prevRound, phase: prevPhase } = ledger.previousRoundPhase(
      gameId,
    );

    // Determine the winner once, from the source of truth, so downstream code
    // never needs to re-derive it from raw counts.
    const winner: "VILLAGERS" | "WEREWOLVES" | "DRAW" | null = isFinished
      ? (werewolfCount === 0 && villagerCount === 0)
        ? "DRAW"
        : werewolfCount === 0
          ? "VILLAGERS"
          : "WEREWOLVES"
      : null;

    return new GameView({
      gameId,
      round,
      phase,
      isFinished,
      winner,
      playerCount,
      aliveIndices,
      aliveCount,
      aliveSet,
      aliveVector,
      werewolfCount,
      villagerCount,
      prevRound,
      prevPhase,
    });
  }

  /**
   * Returns true if all derived numeric fields are finite.
   *
   * A non-finite value (NaN, ±Infinity) causes a silent PostgreSQL type error
   * that aborts the entire transaction and makes every subsequent query fail
   * with 25P02. Checking here prevents that cascade.
   */
  isValid(): boolean {
    return (
      Number.isFinite(this.round) &&
      Number.isFinite(this.playerCount) &&
      Number.isFinite(this.aliveCount) &&
      Number.isFinite(this.werewolfCount) &&
      Number.isFinite(this.villagerCount)
    );
  }
}
