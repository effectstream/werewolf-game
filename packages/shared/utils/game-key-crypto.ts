/**
 * Symmetric encryption for 32-byte game seeds stored on-chain.
 *
 * Format (64 bytes):
 *   [0..31]  — random salt
 *   [32..63] — seed XOR HKDF(WEREWOLF_KEY_SECRET, salt, "werewolf-game-seed-v1", 32)
 *
 * Any node that shares the same WEREWOLF_KEY_SECRET env var can decrypt the
 * seed.  Two nodes encrypting the same seed will produce different blobs
 * (different salts), but both can decrypt either blob.
 *
 * Hex representation: 128 hex characters (64 bytes × 2).
 */

const INFO = new TextEncoder().encode("werewolf-game-seed-v1");

/** Derive a 32-byte keystream from WEREWOLF_KEY_SECRET + salt via HKDF-SHA-256. */
async function deriveKeystream(
  secret: string,
  // Must be backed by a plain ArrayBuffer (not SharedArrayBuffer) for Web Crypto.
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: INFO },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

function xor32(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * Encrypt a 32-byte game seed.
 * Returns a 64-byte blob: salt (32 bytes) || ciphertext (32 bytes).
 */
export async function encryptGameSeed(
  seed: Uint8Array,
  secret: string,
): Promise<Uint8Array> {
  if (seed.length !== 32) {
    throw new Error(`encryptGameSeed: expected 32-byte seed, got ${seed.length}`);
  }
  // Two-step form so `salt` is typed as Uint8Array<ArrayBuffer>, not ArrayBufferLike.
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  const keystream = await deriveKeystream(secret, salt);
  const ciphertext = xor32(seed, keystream);
  const blob = new Uint8Array(64);
  blob.set(salt, 0);
  blob.set(ciphertext, 32);
  return blob;
}

/**
 * Decrypt a 64-byte encrypted blob back to the 32-byte game seed.
 */
export async function decryptGameSeed(
  blob: Uint8Array,
  secret: string,
): Promise<Uint8Array> {
  if (blob.length !== 64) {
    throw new Error(`decryptGameSeed: expected 64-byte blob, got ${blob.length}`);
  }
  // Use slice() (not subarray) so each copy is backed by a fresh ArrayBuffer,
  // satisfying Web Crypto's Uint8Array<ArrayBuffer> requirement.
  const salt = blob.slice(0, 32) as Uint8Array<ArrayBuffer>;
  const ciphertext = blob.slice(32, 64);
  const keystream = await deriveKeystream(secret, salt);
  return xor32(ciphertext, keystream);
}

/** Encode a 64-byte encrypted blob as a 128-character hex string. */
export function encryptedSeedToHex(blob: Uint8Array): string {
  return Array.from(blob).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decode a 128-character hex string back to a 64-byte encrypted blob. */
export function hexToEncryptedSeed(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 128) {
    throw new Error(
      `hexToEncryptedSeed: expected 128-char hex (64 bytes), got ${clean.length} chars`,
    );
  }
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
