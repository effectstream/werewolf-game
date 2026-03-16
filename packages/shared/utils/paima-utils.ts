/**
 * MidnightLedgerParser
 *
 * Single-responsibility class that knows only how to decode Midnight's wire
 * format. No game concepts belong here.
 */
export class MidnightLedgerParser {
  /** Uint8Array → "0x…" hex string */
  toHex(uint8Array: Uint8Array): string {
    return "0x" + Array.from(uint8Array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Deep-convert Midnight Maps/Sets/BigInts to JSON-safe values.
   *
   * Paima's JSON serialization (used by the syncer before storing data in the
   * DB) uses standard JSON.stringify which fails on Map objects (becoming {})
   * and BigInts (throwing or becoming null).
   *
   * Midnight contracts extensively use Map objects and BigInts for state.
   * This utility recursively converts these into plain JSON-compatible objects
   * and strings.
   */
  convertLedger(obj: unknown): unknown {
    // Handle Midnight Map-like and Set-like objects (they use custom classes
    // with Symbol.iterator)
    if (
      obj && typeof obj === "object" &&
      typeof (obj as Record<symbol, unknown>)[Symbol.iterator] === "function" &&
      !Array.isArray(obj) &&
      !(obj instanceof Uint8Array)
    ) {
      const isMapLike = typeof (obj as Record<string, unknown>)["lookup"] ===
        "function";
      if (isMapLike) {
        const newObj: Record<string, unknown> = {};
        for (const entry of obj as Iterable<unknown>) {
          if (Array.isArray(entry) && entry.length === 2) {
            const [key, value] = entry as [unknown, unknown];
            const stringKey = (key instanceof Uint8Array)
              ? this.toHex(key)
              : (key !== null && typeof key === "object")
              ? JSON.stringify(
                key,
                (_, v) => typeof v === "bigint" ? v.toString() : v,
              )
              : String(key);
            newObj[stringKey] = this.convertLedger(value);
          }
        }
        return newObj;
      } else {
        // Set-like or other iterable
        const newArr: unknown[] = [];
        for (const entry of obj as Iterable<unknown>) {
          newArr.push(this.convertLedger(entry));
        }
        return newArr;
      }
    }

    // Handle standard Map objects
    if (obj instanceof Map) {
      const newObj: Record<string, unknown> = {};
      for (const [key, value] of obj) {
        const stringKey = (key instanceof Uint8Array)
          ? this.toHex(key)
          : (key !== null && typeof key === "object")
          ? JSON.stringify(
            key,
            (_, v) => typeof v === "bigint" ? v.toString() : v,
          )
          : String(key);
        newObj[stringKey] = this.convertLedger(value);
      }
      return newObj;
    }

    // Handle Arrays
    if (Array.isArray(obj)) {
      return (obj as unknown[]).map((item) => this.convertLedger(item));
    }

    // Handle Uint8Array as values
    if (obj instanceof Uint8Array) {
      return this.toHex(obj);
    }

    // Handle BigInts
    if (typeof obj === "bigint") {
      return obj.toString();
    }

    // Recursively handle Objects
    if (obj !== null && typeof obj === "object") {
      const newObj: Record<string, unknown> = {};
      for (const key in obj as object) {
        newObj[key] = this.convertLedger((obj as Record<string, unknown>)[key]);
      }
      return newObj;
    }

    return obj;
  }

  /**
   * Ledger maps arrive as Map | plain object | array-of-pairs | null.
   *
   * Midnight's convertLedger can emit a Map<K,V> as either:
   *   - a plain object  { "key": value, … }           (Map-like branch)
   *   - an array of [key, value] pairs                 (Set-like fallback)
   *
   * Returns a uniform Record<string, unknown> in all cases.
   */
  parseMap(raw: unknown): Record<string, unknown> {
    if (raw == null) return {};
    if (raw instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of raw.entries()) {
        out[String(k)] = v;
      }
      return out;
    }
    // convertLedger emits Set-like iterables (including Map entries when the
    // Midnight object lacks a `lookup` method) as a plain JS array of entries.
    // Each entry is either [key, value] (2-element array) or a scalar.
    if (Array.isArray(raw)) {
      const out: Record<string, unknown> = {};
      for (const entry of raw) {
        if (Array.isArray(entry) && entry.length === 2) {
          out[String(entry[0])] = entry[1];
        }
      }
      return out;
    }
    if (typeof raw === "object") return raw as Record<string, unknown>;
    return {};
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible re-exports (used by consumers that import the old
// function names directly)
// ---------------------------------------------------------------------------

const _sharedParser = new MidnightLedgerParser();

/** @deprecated Use `MidnightLedgerParser#toHex` instead. */
export function toHex(uint8Array: Uint8Array): string {
  return _sharedParser.toHex(uint8Array);
}

export function convertMidnightLedger(obj: unknown): unknown {
  return _sharedParser.convertLedger(obj);
}
