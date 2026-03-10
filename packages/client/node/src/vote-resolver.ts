/**
 * Automated phase resolution: decrypt votes, tally results, submit to contract.
 *
 * Called by triggerMidnightVoteSubmission() when all votes for a round/phase
 * have been collected.
 *
 * Flow:
 * 1. Retrieve encrypted votes + game secrets + player bundles from store
 * 2. Decrypt each vote using admin secret key + player public key (Curve25519 DH)
 * 3. Tally votes (majority wins; night ties break randomly; day ties = no elimination)
 * 4. Submit resolveNightPhase or resolveDayPhase to the contract via batcher
 */

import nacl from "tweetnacl";
import Prando from "prando";

// Deno's ESM resolution for the 'prando' NPM package sometimes treats it as a module
// rather than a class. This hack ensures we get the constructable class at runtime.
const PrandoClass = (Prando as any).default || Prando;
import * as store from "./store.ts";
import { callMidnightCircuit } from "./midnight-circuit-caller.ts";
import type { PrivateState } from "../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";
import { runPreparedQuery } from "@paimaexample/db";
import { getGameView } from "@werewolf-game/database";
import { getDbPool } from "./db-pool.ts";

const BATCHER_URL = Deno.env.get("BATCHER_URL") ?? "http://localhost:3334";

// ---------------------------------------------------------------------------
// Crypto helpers (ported from witnesses.ts / App.tsx)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function deriveSessionKey(
  myPrivKey: Uint8Array,
  theirPubKey: Uint8Array,
  txNonce: number,
): Uint8Array {
  const sharedPoint = nacl.scalarMult(myPrivKey, theirPubKey);
  const nonceBytes = new Uint8Array(new Int32Array([txNonce]).buffer);
  const combined = new Uint8Array(sharedPoint.length + nonceBytes.length);
  combined.set(sharedPoint);
  combined.set(nonceBytes, sharedPoint.length);
  return nacl.hash(combined).slice(0, 3);
}

function xorDecrypt(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    result[i] = ciphertext[i] ^ key[i];
  }
  return result;
}

function unpackData(
  bytes: Uint8Array,
): { target: number; round: number; random: number } {
  const packed = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  const target = (packed >> 17) & 0x7f;
  const round = (packed >> 10) & 0x7f;
  const random = packed & 0x3ff;
  return { target, round, random };
}

// ---------------------------------------------------------------------------
// Vote decryption
// ---------------------------------------------------------------------------

export type DecryptedVote = {
  voterIndex: number;
  target: number;
  round: number;
};

/**
 * Decrypt all encrypted votes for a round/phase using the admin vote secret key
 * and player public keys derived from leaf secrets in their bundles.
 */
export function decryptVotes(
  gameId: number,
  round: number,
  phase: string,
): DecryptedVote[] {
  const votes = store.getVotes(gameId, round, phase);
  const secrets = store.getGameSecrets(gameId);
  const bundles = store.getAllBundlesForGame(gameId);

  if (!secrets) {
    throw new Error(`[vote-resolver] No game secrets for game=${gameId}`);
  }
  if (bundles.length === 0) {
    throw new Error(`[vote-resolver] No bundles for game=${gameId}`);
  }

  // Build a map of playerId → Curve25519 public key
  const playerPubKeys = new Map<number, Uint8Array>();
  for (const bundle of bundles) {
    const leafSecretBytes = hexToBytes(bundle.leafSecret);
    const pubKey = nacl.scalarMult.base(leafSecretBytes);
    playerPubKeys.set(bundle.playerId, pubKey);
  }

  const adminSecretKey = secrets.adminVoteKeypair.secretKey;
  const decrypted: DecryptedVote[] = [];

  for (const vote of votes) {
    const ciphertext = hexToBytes(vote.encryptedVoteHex);
    if (ciphertext.length < 3) {
      console.warn(
        `[vote-resolver] Skipping vote from voter=${vote.voterIndex}: ciphertext too short`,
      );
      continue;
    }

    const playerPubKey = playerPubKeys.get(vote.voterIndex);
    if (playerPubKey) {
      // Direct lookup — we know the voter
      try {
        const sessionKey = deriveSessionKey(
          adminSecretKey,
          playerPubKey,
          round,
        );
        const plaintext = xorDecrypt(ciphertext.slice(0, 3), sessionKey);
        const data = unpackData(plaintext);
        if (data.round === round) {
          decrypted.push({
            voterIndex: vote.voterIndex,
            target: data.target,
            round: data.round,
          });
          continue;
        }
      } catch {
        // fall through to brute force
      }
    }

    // Fallback: brute-force try all player keys (voterIndex mismatch)
    let found = false;
    for (const [playerId, pubKey] of playerPubKeys) {
      if (playerId === vote.voterIndex) continue; // already tried
      try {
        const sessionKey = deriveSessionKey(adminSecretKey, pubKey, round);
        const plaintext = xorDecrypt(ciphertext.slice(0, 3), sessionKey);
        const data = unpackData(plaintext);
        if (data.round === round) {
          decrypted.push({
            voterIndex: vote.voterIndex,
            target: data.target,
            round: data.round,
          });
          found = true;
          break;
        }
      } catch {
        // try next key
      }
    }

    if (!found) {
      console.warn(
        `[vote-resolver] Could not decrypt vote from voter=${vote.voterIndex}`,
      );
    }
  }

  return decrypted;
}

// ---------------------------------------------------------------------------
// Vote tallying
// ---------------------------------------------------------------------------

export type TallyResult = {
  targetIdx: number;
  hasElimination: boolean;
  info: string;
};

/**
 * Tally decrypted votes.
 * - Night ties: randomly pick one of the tied targets.
 * - Day ties: no elimination.
 */
export function tallyVotes(
  decryptedVotes: DecryptedVote[],
  aliveIndices: Set<number>,
  isNight: boolean,
  prando: any, // Using any here because of the Prando typing issues in Deno
): TallyResult {
  const counts = new Map<number, number>();
  for (const vote of decryptedVotes) {
    if (!aliveIndices.has(vote.voterIndex)) continue;
    if (!aliveIndices.has(vote.target)) continue;
    counts.set(vote.target, (counts.get(vote.target) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return { targetIdx: 0, hasElimination: false, info: "No valid votes." };
  }

  let maxVotes = 0;
  for (const count of counts.values()) {
    if (count > maxVotes) maxVotes = count;
  }

  const tied: number[] = [];
  for (const [idx, count] of counts.entries()) {
    if (count === maxVotes) tied.push(idx);
  }

  if (tied.length === 1) {
    return {
      targetIdx: tied[0],
      hasElimination: true,
      info: `Consensus on player ${tied[0]}.`,
    };
  }

  if (isNight) {
    const pick = tied[prando.nextInt(0, tied.length - 1)];
    return {
      targetIdx: pick,
      hasElimination: true,
      info: `Night tie; randomly selected player ${pick}.`,
    };
  }

  return {
    targetIdx: 0,
    hasElimination: false,
    info: "Day tie; no elimination.",
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Decrypt votes, tally results, and submit phase resolution to the contract.
 *
 * @returns The tally result (targetIdx, hasElimination, info).
 */
export async function resolvePhaseFromVotes(
  gameId: number,
  round: number,
  phase: string,
): Promise<TallyResult> {
  const isNight = phase.toUpperCase() === "NIGHT";

  console.log(
    `[vote-resolver] Resolving game=${gameId} round=${round} phase=${phase}`,
  );

  // 1. Decrypt votes
  const decryptedVotes = decryptVotes(gameId, round, phase);
  console.log(
    `[vote-resolver] Decrypted ${decryptedVotes.length} votes:`,
    decryptedVotes.map((v) => `voter=${v.voterIndex}→target=${v.target}`).join(
      ", ",
    ),
  );

  // 2. Get alive indices from the DB game view
  const dbConn = getDbPool();
  const rows = await runPreparedQuery(
    getGameView.run({ game_id: gameId }, dbConn),
    "getGameView",
  );
  if (rows.length === 0) {
    throw new Error(`[vote-resolver] No game view for game=${gameId}`);
  }
  const aliveVector: boolean[] = JSON.parse(rows[0].alive_vector);
  const aliveIndices = new Set<number>();
  for (let i = 0; i < aliveVector.length; i++) {
    if (aliveVector[i]) aliveIndices.add(i);
  }

  // 3. Tally votes
  // Initialize Prando with a deterministic seed [gameId, round, phase]
  const seed = `${gameId}:${round}:${phase.toUpperCase()}`;
  const prando = new PrandoClass(seed);
  const tally = tallyVotes(decryptedVotes, aliveIndices, isNight, prando);
  console.log(
    `[vote-resolver] Tally result: targetIdx=${tally.targetIdx} hasElimination=${tally.hasElimination} — ${tally.info}`,
  );

  // 4. Get Merkle root (needed for resolveNightPhase)
  const merkleRoot = store.getMerkleRoot(gameId);
  if (!merkleRoot) {
    throw new Error(`[vote-resolver] No Merkle root for game=${gameId}`);
  }

  // 5. Get admin wallet seed — required so std_ownPublicKey() matches state.adminKey
  const secrets = store.getGameSecrets(gameId);
  const adminWalletSeed = secrets?.adminWalletSeed;
  if (!adminWalletSeed) {
    throw new Error(
      `[vote-resolver] No admin wallet seed for game=${gameId} — createMidnightGame must succeed before resolve`,
    );
  }

  // 6. Submit to contract via delegated balancing.
  // resolveNight/resolveDay use disclose() for all arguments — no witnesses needed.
  const emptyPrivateState: PrivateState = { setupData: new Map() };

  if (isNight) {
    await callMidnightCircuit({
      circuitId: "resolveNightPhase",
      privateState: emptyPrivateState,
      batcherUrl: BATCHER_URL,
      seed: adminWalletSeed,
      callFn: async (contract) => {
        await contract.callTx.resolveNightPhase(
          BigInt(gameId),
          BigInt(round + 1),
          BigInt(tally.targetIdx),
          tally.hasElimination,
          merkleRoot,
        );
      },
    });
  } else {
    await callMidnightCircuit({
      circuitId: "resolveDayPhase",
      privateState: emptyPrivateState,
      batcherUrl: BATCHER_URL,
      seed: adminWalletSeed,
      callFn: async (contract) => {
        await contract.callTx.resolveDayPhase(
          BigInt(gameId),
          BigInt(tally.targetIdx),
          tally.hasElimination,
        );
      },
    });
  }

  console.log(
    `[vote-resolver] Phase resolution submitted for game=${gameId} round=${round} phase=${phase}`,
  );

  return tally;
}
