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

  // ── Player / vote accessors ──────────────────────────────────────────────

  /**
   * Indices of alive players for a game.
   * Handles both array-of-{key,value} and plain object-keyed-by-index formats.
   */
  aliveIndices(gameId: number): number[] {
    const aliveMap = this.parser.parseMap(
      this.payload["Werewolf_playerAlive"],
    );
    const aliveVec = aliveMap[String(gameId)] ??
      aliveMap[JSON.stringify(gameId)] ??
      aliveMap;
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
      for (const entry of aliveVec) {
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
