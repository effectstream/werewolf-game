import { MidnightLedgerParser } from "./paima-utils.ts";
import { GameView } from "./werewolf-game-view.ts";

/**
 * Plain-object type for a single Werewolf game record as it comes out of the
 * Midnight ledger.
 */
export interface GameStateRecord {
  phase?: number | string;
  currentPhase?: number | string;
  round?: number | string;
  playerCount?: number | string;
  aliveCount?: number | string;
  werewolfCount?: number | string;
  villagerCount?: number | string;
  [key: string]: unknown;
}

/**
 * WerewolfLedger
 *
 * Wraps a raw Paima–Midnight payload and exposes intention-revealing,
 * type-safe accessors for all Werewolf on-chain state.
 *
 * Composes a `MidnightLedgerParser` so a custom parser can be injected for
 * testing.
 */
export class WerewolfLedger {
  // Lazy-parsed cache for the games map
  #gamesCache?: Record<string, unknown>;

  private constructor(
    private readonly payload: Record<string, unknown>,
    private readonly parser: MidnightLedgerParser,
  ) {}

  /**
   * Factory — creates an instance with the default shared parser.
   * Pass a custom `parser` to override (useful in tests).
   */
  static from(
    payload: unknown,
    parser = new MidnightLedgerParser(),
  ): WerewolfLedger {
    return new WerewolfLedger(
      (payload ?? {}) as Record<string, unknown>,
      parser,
    );
  }

  // ── Ledger maps ──────────────────────────────────────────────────────────

  /** All games, keyed by their raw ledger string key. Cached after first call. */
  games(): Record<string, unknown> {
    return (this.#gamesCache ??= this.parser.parseMap(
      this.payload["Werewolf_games"],
    ));
  }

  /**
   * Numeric gameId from a raw ledger key.
   * Handles JSON-encoded keys (e.g. `"42"` or `{"id":42}`) and plain numbers.
   */
  parseGameId(rawKey: string): number {
    try {
      const parsed = JSON.parse(rawKey);
      if (typeof parsed === "number") return parsed;
      if (parsed && typeof parsed === "object") {
        const id = (parsed as Record<string, unknown>)["id"] ??
          (parsed as Record<string, unknown>)["gameId"] ??
          parsed;
        return Number(id);
      }
      return Number(parsed);
    } catch {
      return Number(rawKey);
    }
  }

  /** Typed game state object for a single gameId, or null if absent. */
  getGame(gameId: number): GameStateRecord | null {
    const g = this.games();
    // Try numeric key, JSON-stringified key, and string key
    const candidates = [
      String(gameId),
      JSON.stringify(gameId),
    ];
    for (const [rawKey, val] of Object.entries(g)) {
      if (candidates.includes(rawKey) || this.parseGameId(rawKey) === gameId) {
        return val as GameStateRecord;
      }
    }
    return null;
  }

  // ── Game-level accessors ─────────────────────────────────────────────────

  /** Current round number for a game (0 if not found). */
  getRound(gameId: number): number {
    const game = this.getGame(gameId);
    if (!game) return 0;
    const r = game["round"];
    return typeof r === "number" ? r : Number(r ?? 0);
  }

  /** Current phase string for a game ("day" if not found). */
  getPhase(gameId: number): string {
    const game = this.getGame(gameId);
    if (!game) return "day";
    const p = game["phase"] ?? game["currentPhase"] ?? "day";
    return typeof p === "string" ? p : String(p);
  }

  // ── Phase / round transition helpers ─────────────────────────────────────

  /**
   * Canonical phase string for a game.
   * Normalises whatever the contract emits ("1", "2", "3", "night", "day", …)
   * into one of three stable values used throughout the codebase.
   */
  phaseString(gameId: number): "NIGHT" | "DAY" | "FINISHED" {
    const raw = String(this.getPhase(gameId)).toLowerCase();
    if (raw === "1" || raw === "night") return "NIGHT";
    if (raw === "2" || raw === "day") return "DAY";
    if (raw === "3" || raw === "finished") return "FINISHED";
    // "0"/"lobby" is expected before game start and also maps to FINISHED so
    // the STM skips round logic for games not yet active.
    if (raw !== "0" && raw !== "lobby") {
      console.warn(
        `[WerewolfLedger] Unexpected phase value "${raw}" for game ${gameId} — treating as FINISHED`,
      );
    }
    return "FINISHED";
  }

  /**
   * The (round, phase) pair that immediately preceded the current on-chain
   * state. Used for death-detection comparisons and vote-purge triggers.
   *
   * Transition model on-chain:
   *   Night → Day  : round stays the same, phase goes 1→2
   *   Day → Night  : round increments, phase goes 2→1
   *
   * Therefore:
   *   current="Night" (1) → previous was Day of (round - 1)
   *   current="Day"   (2) → previous was Night of the same round
   */
  previousRoundPhase(
    gameId: number,
  ): { round: number; phase: "NIGHT" | "DAY" } {
    const round = this.getRound(gameId);
    const phase = this.phaseString(gameId);
    if (phase === "NIGHT") {
      return { round: round - 1, phase: "DAY" };
    }
    return { round, phase: "NIGHT" };
  }

  // ── Player / vote accessors ──────────────────────────────────────────────

  /**
   * Indices of alive players for a game.
   * Iterates the `Werewolf_playerAlive` Map keyed by GamePlayerKey
   * (serialised as JSON `{"gameId":N,"playerIdx":M}`) and collects
   * indices where the value is `true`.
   */
  aliveIndices(gameId: number): number[] {
    const aliveMap = this.parser.parseMap(
      this.payload["Werewolf_playerAlive"],
    );
    const indices: number[] = [];
    for (const [rawKey, value] of Object.entries(aliveMap)) {
      try {
        const keyObj = JSON.parse(rawKey);
        if (Number(keyObj.gameId) === gameId && value === true) {
          indices.push(Number(keyObj.playerIdx));
        }
      } catch {
        // not a JSON composite key — skip
      }
    }
    return indices.sort((a, b) => a - b);
  }

  /** Number of alive players for a game. */
  aliveCount(gameId: number): number {
    return this.aliveIndices(gameId).length;
  }

  /**
   * All encrypted votes for a given (gameId, round, phase) tuple.
   * Iterates the `Werewolf_encryptedVotes` Map keyed by VoteKey
   * (serialised as JSON `{"gameId":N,"round":N,"phase":N,"nullifier":"..."}`)
   * and collects matching Bytes<3> values.
   */
  getVotesForRoundAndPhase(
    gameId: number,
    round: number,
    phase: number | string,
  ): unknown[] {
    const votesMap = this.parser.parseMap(
      this.payload["Werewolf_roundVotes"],
    );
    const phaseNum = typeof phase === "string"
      ? (phase.toUpperCase() === "NIGHT" || phase === "1" ? 1 : 2)
      : phase;
    const votes: unknown[] = [];
    for (const [rawKey, value] of Object.entries(votesMap)) {
      try {
        const keyObj = JSON.parse(rawKey);
        if (
          Number(keyObj.gameId) === gameId &&
          Number(keyObj.round) === round &&
          Number(keyObj.phase) === phaseNum
        ) {
          votes.push(value);
        }
      } catch {
        // not a JSON composite key — skip
      }
    }
    return votes;
  }

  /**
   * Submitted-vote count for a (gameId, round) pair.
   * Derived from the length of matching encryptedVotes entries.
   */
  voteCount(gameId: number, round: number, phase?: number | string): number {
    const p = phase ?? this.getPhase(gameId);
    return this.getVotesForRoundAndPhase(gameId, round, p).length;
  }

  // ── GameView factory ─────────────────────────────────────────────────────

  /**
   * Returns a fully-resolved, ledger-decoupled snapshot of one game's state.
   * Prefer this over calling individual accessors when multiple fields are
   * needed, as it resolves everything in a single pass.
   */
  getGameView(gameId: number): GameView {
    return GameView.from(this, gameId);
  }

}
