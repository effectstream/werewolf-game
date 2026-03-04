import { MidnightLedgerParser } from "./paima-utils.ts";

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
   * Handles both array-of-{key,value} and plain object-keyed-by-index formats.
   */
  aliveIndices(gameId: number): number[] {
    const aliveMap = this.parser.parseMap(
      this.payload["Werewolf_playerAlive"],
    );
    // Look up the Vector<16, Boolean> for this gameId.
    // The key is a Uint<32> serialised as a plain number string.
    const aliveVec = aliveMap[String(gameId)] ??
      aliveMap[JSON.stringify(gameId)] ??
      null;
    if (aliveVec == null) return [];
    return this.#extractAliveIndices(aliveVec);
  }

  /** Number of alive players for a game. */
  aliveCount(gameId: number): number {
    return this.aliveIndices(gameId).length;
  }

  /**
   * Submitted-vote count for a (gameId, round) pair.
   * Tries multiple GameRoundKey serialisation candidates and falls back to
   * JSON.parse iteration.
   */
  voteCount(gameId: number, round: number): number {
    const movesMap = this.parser.parseMap(
      this.payload["Werewolf_movesSubmittedCount"],
    );
    return this.#extractVoteCount(movesMap, gameId, round);
  }

  // ── Private game-logic helpers ───────────────────────────────────────────

  #extractAliveIndices(aliveVec: unknown): number[] {
    if (aliveVec == null) return [];
    const indices: number[] = [];

    if (Array.isArray(aliveVec)) {
      for (let i = 0; i < aliveVec.length; i++) {
        const entry = aliveVec[i];
        // Case 1: Vector<16, Boolean> serialised as a flat boolean array
        //   [true, true, false, …]  — the most common Midnight wire format
        if (typeof entry === "boolean") {
          if (entry) indices.push(i);
          continue;
        }
        // Case 2: array of {key, value} or {playerIdx, alive} objects
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          const alive = e["value"] ?? e["alive"];
          if (alive === true) {
            const idx = e["key"] ?? e["playerIdx"] ?? e["index"];
            if (typeof idx === "number") indices.push(idx);
          }
        }
      }
      return indices;
    }

    // Fallback: plain object keyed by player index string
    const map = this.parser.parseMap(aliveVec);
    for (const [k, v] of Object.entries(map)) {
      if (v === true) {
        const idx = Number(k);
        if (!isNaN(idx)) indices.push(idx);
      }
    }
    return indices;
  }

  #extractVoteCount(
    map: Record<string, unknown>,
    gameId: number,
    round: number,
  ): number {
    const candidates = [
      JSON.stringify({ gameId, round }),
      JSON.stringify({ game_id: gameId, round }),
      `GameRoundKey { gameId: ${gameId}, round: ${round} }`,
      `${gameId}:${round}`,
      String(gameId * 1000 + round),
    ];

    for (const key of candidates) {
      if (key in map) {
        const val = map[key];
        return typeof val === "number" ? val : Number(val) || 0;
      }
    }

    for (const [k, v] of Object.entries(map)) {
      try {
        const parsed = JSON.parse(k);
        if (
          parsed &&
          (parsed.gameId === gameId || parsed.game_id === gameId) &&
          parsed.round === round
        ) {
          return typeof v === "number" ? v : Number(v) || 0;
        }
      } catch {
        // not JSON — skip
      }
    }

    return 0;
  }
}
