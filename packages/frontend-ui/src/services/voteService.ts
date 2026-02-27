import nacl from "tweetnacl";
import type { PlayerBundle } from "../state/gameState";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:9999";

// --- Helpers ---

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Encryption (port of witnesses.ts) ---

function packData(
  targetNumber: number,
  round: number,
  random: number,
): Uint8Array {
  if (targetNumber > 99 || round > 99 || random > 999) {
    throw new Error("Overflow in packData");
  }
  const packed = (targetNumber << 17) | (round << 10) | random;
  const bytes = new Uint8Array(3);
  bytes[0] = (packed >> 16) & 0xff;
  bytes[1] = (packed >> 8) & 0xff;
  bytes[2] = packed & 0xff;
  return bytes;
}

function deriveSessionKey(
  privKey: Uint8Array,
  pubKey: Uint8Array,
  roundNonce: number,
): Uint8Array {
  const sharedPoint = nacl.scalarMult(privKey, pubKey);
  const nonceBytes = new Uint8Array(new Int32Array([roundNonce]).buffer);
  const combined = new Uint8Array(sharedPoint.length + nonceBytes.length);
  combined.set(sharedPoint);
  combined.set(nonceBytes, sharedPoint.length);
  return nacl.hash(combined).slice(0, 3);
}

function encryptVote(
  targetNumber: number,
  round: number,
  random: number,
  privKey: Uint8Array,
  receiverPubKey: Uint8Array,
): Uint8Array {
  const payload = packData(targetNumber, round, random);
  // txNonce = round (same convention as witnesses.ts line 209)
  const sessionKey = deriveSessionKey(privKey, receiverPubKey, round);
  const ciphertext = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    ciphertext[i] = payload[i] ^ sessionKey[i];
  }
  return ciphertext;
}

// --- Public API ---

export interface VoteSubmitResult {
  success: boolean;
  alreadyVoted?: boolean;
  allVotesIn?: boolean;
  voteCount?: number;
  aliveCount?: number;
  error?: string;
}

export async function submitVote(
  bundle: PlayerBundle,
  targetIndex: number,
  round: number,
  phase: string,
  gameId: number,
): Promise<VoteSubmitResult> {
  // Derive NaCl private key from leafSecret (32 bytes used directly as scalar)
  const privKey = hexToBytes(bundle.leafSecret);
  if (privKey.length !== 32) {
    throw new Error(`leafSecret must be 32 bytes, got ${privKey.length}`);
  }

  // adminVotePublicKeyHex is 33 bytes (compressed EC key); NaCl needs 32 bytes
  const rawPubKey = hexToBytes(bundle.adminVotePublicKeyHex);
  const receiverPubKey = rawPubKey.slice(0, 32);

  const random = Math.floor(Math.random() * 1000);

  const ciphertext = encryptVote(
    targetIndex,
    round,
    random,
    privKey,
    receiverPubKey,
  );
  const encryptedVoteHex = bytesToHex(ciphertext);
  const merklePathJson = JSON.stringify(bundle.merklePath);

  const body = {
    gameId,
    round,
    phase,
    voterIndex: bundle.playerId,
    targetIndex,
    encryptedVoteHex,
    merklePathJson,
  };

  console.log("[voteService] submitting vote:", {
    gameId,
    round,
    phase,
    voterIndex: bundle.playerId,
    targetIndex,
    encryptedVoteHex,
  });

  const res = await fetch(`${API_BASE}/api/submit_vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[voteService] submit_vote failed:", res.status, text);
    return { success: false, error: `HTTP ${res.status}: ${text}` };
  }

  const result = await res.json() as VoteSubmitResult;
  console.log("[voteService] submit_vote response:", result);
  return result;
}
