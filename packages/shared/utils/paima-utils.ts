/**
 * Utility to convert Uint8Array to hex string.
 */
export function toHex(uint8Array: Uint8Array): string {
  return "0x" + Array.from(uint8Array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Paima's JSON serialization (used by the syncer before storing data in the DB)
 * uses standard JSON.stringify which fails on Map objects (becoming {})
 * and BigInts (throwing or becoming null).
 *
 * Midnight contracts extensively use Map objects and BigInts for state.
 * This utility recursively converts these into plain JSON-compatible objects and strings.
 */
export function convertMidnightLedger(obj: any): any {
  // Handle Midnight Map-like and Set-like objects (they use custom classes with Symbol.iterator)
  if (
    obj && typeof obj === "object" &&
    typeof obj[Symbol.iterator] === "function" &&
    !Array.isArray(obj) &&
    !(obj instanceof Uint8Array)
  ) {
    const isMapLike = typeof obj.lookup === "function";
    if (isMapLike) {
      const newObj: any = {};
      for (const entry of obj) {
        if (Array.isArray(entry) && entry.length === 2) {
          const [key, value] = entry;
          const stringKey = (key instanceof Uint8Array)
            ? toHex(key)
            : (key !== null && typeof key === "object")
            ? JSON.stringify(key, (_, v) => typeof v === "bigint" ? v.toString() : v)
            : String(key);
          newObj[stringKey] = convertMidnightLedger(value);
        }
      }
      return newObj;
    } else {
      // Set-like or other iterable
      const newArr: any[] = [];
      for (const entry of obj) {
        newArr.push(convertMidnightLedger(entry));
      }
      return newArr;
    }
  }

  // Handle standard Map objects
  if (obj instanceof Map) {
    const newObj: any = {};
    for (const [key, value] of obj) {
      const stringKey = (key instanceof Uint8Array)
        ? toHex(key)
        : (key !== null && typeof key === "object")
        ? JSON.stringify(key, (_, v) => typeof v === "bigint" ? v.toString() : v)
        : String(key);
      newObj[stringKey] = convertMidnightLedger(value);
    }
    return newObj;
  }

  // Handle Arrays
  if (Array.isArray(obj)) {
    return obj.map(convertMidnightLedger);
  }

  // Handle Uint8Array as values
  if (obj instanceof Uint8Array) {
    return toHex(obj);
  }

  // Handle BigInts
  if (typeof obj === "bigint") {
    return obj.toString();
  }

  // Recursively handle Objects
  if (obj !== null && typeof obj === "object") {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = convertMidnightLedger(obj[key]);
    }
    return newObj;
  }

  return obj;
}
