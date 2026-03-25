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
import { getGameView, resolveRound } from "@werewolf-game/database";
import { getDbPool } from "./db-pool.ts";
import {
  computeRoundActionsDigest,
  computeVoteNullifier,
} from "../../../shared/utils/round-actions-digest.ts";
import type { WerewolfVoteEntry } from "../../../shared/utils/werewolf-ledger.ts";
import { restoreGameSecrets } from "./lobby-closer.ts";

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
// Ledger-bytes parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse a single Bytes<3> value from the Midnight ledger.
 *
 * MidnightLedgerParser.convertLedger() converts Uint8Array values to
 * "0x..." hex strings before they are stored in the DB payload. This function
 * handles that format as well as raw Uint8Array and number arrays.
 */
function parseLedgerBytes3(v: unknown): Uint8Array {
  if (typeof v === "string") {
    const hex = v.startsWith("0x") ? v.slice(2) : v;
    if (hex.length < 6) return new Uint8Array(3);
    const bytes = new Uint8Array(3);
    bytes[0] = parseInt(hex.slice(0, 2), 16);
    bytes[1] = parseInt(hex.slice(2, 4), 16);
    bytes[2] = parseInt(hex.slice(4, 6), 16);
    return bytes;
  }
  if (v instanceof Uint8Array) return v.slice(0, 3);
  if (Array.isArray(v)) return new Uint8Array((v as number[]).slice(0, 3));
  console.warn(
    `[vote-resolver] Unexpected ledger Bytes<3> format: ${JSON.stringify(v)}`,
  );
  return new Uint8Array(3);
}

function buildRoundActionsDigestFromLedger(
  gameId: number,
  round: number,
  phase: string,
  voteEntries: WerewolfVoteEntry[],
): Uint8Array {
  return computeRoundActionsDigest(
    gameId,
    round,
    phase,
    voteEntries.map((vote) => ({
      nullifier: vote.key.nullifier,
      encryptedAction: parseLedgerBytes3(vote.encryptedVote),
    })),
  );
}

function buildRoundActionsDigestFromStore(
  gameId: number,
  round: number,
  phase: string,
): Uint8Array {
  const votes = store.getVotes(gameId, round, phase);
  const bundlesByPlayer = new Map(
    store.getAllBundlesForGame(gameId).map((bundle) => [bundle.playerId, bundle]),
  );

  const actions = votes.map((vote) => {
    const bundle = bundlesByPlayer.get(vote.voterIndex);
    if (!bundle) {
      throw new Error(
        `[vote-resolver] Missing bundle for voter=${vote.voterIndex} game=${gameId}`,
      );
    }

    return {
      nullifier: computeVoteNullifier(
        gameId,
        round,
        phase,
        hexToBytes(bundle.leafSecret),
      ),
      encryptedAction: hexToBytes(vote.encryptedVoteHex).slice(0, 3),
    };
  });

  return computeRoundActionsDigest(gameId, round, phase, actions);
}

// ---------------------------------------------------------------------------
// Ledger-based resolution (player-delegated voting path)
// ---------------------------------------------------------------------------

/**
 * Resolve a round/phase using encrypted votes read directly from the on-chain
 * ledger (Werewolf_roundVotes map).
 *
 * Called by the STF (midnightContractState) when the on-chain vote count first
 * reaches the eligible-voter threshold. Since the nullifier hides voter
 * identity, we brute-force all player public keys to decrypt each ciphertext.
 *
 * @param encryptedVotes - Raw values from WerewolfLedger.getVotesForRoundAndPhase()
 */
export async function resolvePhaseFromLedger(
  gameId: number,
  round: number,
  phase: string,
  voteEntries: WerewolfVoteEntry[],
  punishedIndices: number[] = [],
): Promise<TallyResult> {
  const isNight = phase.toUpperCase() === "NIGHT";

  console.log(
    `[vote-resolver] resolvePhaseFromLedger game=${gameId} round=${round} phase=${phase} votes=${voteEntries.length}`,
  );

  let secrets = store.getGameSecrets(gameId);
  let bundles = store.getAllBundlesForGame(gameId);

  if (!secrets || bundles.length === 0) {
    console.warn(
      `[vote-resolver] game=${gameId}: secrets=${secrets ? "ok" : "MISSING"} bundles=${bundles.length} — attempting on-demand recovery`,
    );
    const restored = await restoreGameSecrets(gameId);
    if (!restored) {
      throw new Error(
        `[vote-resolver] No game secrets for game=${gameId} — cannot decrypt ledger votes`,
      );
    }
    secrets = store.getGameSecrets(gameId);
    bundles = store.getAllBundlesForGame(gameId);
    if (!secrets) {
      throw new Error(
        `[vote-resolver] Secret recovery succeeded but secrets still missing for game=${gameId}`,
      );
    }
    console.log(
      `[vote-resolver] game=${gameId}: secrets restored ok — bundles=${bundles.length}`,
    );
  } else {
    console.log(
      `[vote-resolver] resolvePhaseFromLedger: secrets=ok bundles=${bundles.length}`,
    );
  }

  // Build Curve25519 public key for each player derived from their leaf secret
  const playerPubKeys: { playerId: number; pubKey: Uint8Array }[] = bundles.map(
    (b) => ({
      playerId: b.playerId,
      pubKey: nacl.scalarMult.base(hexToBytes(b.leafSecret)),
    }),
  );

  const adminSecretKey = secrets.adminVoteKeypair.secretKey;
  const decrypted: DecryptedVote[] = [];

  for (const entry of voteEntries) {
    const ciphertext = parseLedgerBytes3(entry.encryptedVote);

    // Brute-force: try each player's public key until the round stamp validates
    let found = false;
    for (const { playerId, pubKey } of playerPubKeys) {
      try {
        const sessionKey = deriveSessionKey(adminSecretKey, pubKey, round);
        const plaintext = xorDecrypt(ciphertext, sessionKey);
        const data = unpackData(plaintext);
        if (data.round === round && data.target < bundles.length) {
          decrypted.push({
            voterIndex: playerId,
            target: data.target,
            round: data.round,
          });
          found = true;
          break;
        }
      } catch {
        // try next player key
      }
    }

    if (!found) {
      console.warn(
        `[vote-resolver] Could not decrypt ledger vote ciphertext for nullifier=${JSON.stringify(entry.key.nullifier)}`,
      );
    }
  }

  console.log(
    `[vote-resolver] Decrypted ${decrypted.length}/${voteEntries.length} ledger votes:`,
    decrypted.map((v) => `voter=${v.voterIndex}→target=${v.target}`).join(", "),
  );

  // Cache decrypted votes so the admin UI can display them via /api/admin/decrypted_votes
  store.setDecryptedVotes(gameId, round, phase, decrypted);

  // Get current alive vector from the DB game view
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
  // Remove recently punished players whose elimination hasn't synced to DB yet
  for (const idx of punishedIndices) {
    aliveIndices.delete(idx);
  }

  const seed = `${gameId}:${round}:${phase.toUpperCase()}`;
  const prando = new PrandoClass(seed);
  const tally = tallyVotes(decrypted, aliveIndices, isNight, prando);
  console.log(
    `[vote-resolver] Ledger tally: targetIdx=${tally.targetIdx} hasElimination=${tally.hasElimination} — ${tally.info}`,
  );

  const merkleRoot = store.getMerkleRoot(gameId);
  if (!merkleRoot) {
    throw new Error(`[vote-resolver] No Merkle root for game=${gameId}`);
  }

  const adminWalletSeed = secrets.adminWalletSeed;
  if (!adminWalletSeed) {
    throw new Error(
      `[vote-resolver] No admin wallet seed for game=${gameId}`,
    );
  }

  const emptyPrivateState: PrivateState = { setupData: new Map() };
  const roundActionsDigest = buildRoundActionsDigestFromLedger(
    gameId,
    round,
    phase,
    voteEntries,
  );

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
          roundActionsDigest,
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
          roundActionsDigest,
        );
      },
    });
  }

  console.log(
    `[vote-resolver] Ledger phase resolution submitted game=${gameId} round=${round} phase=${phase}`,
  );

  // Mark the round resolved in the DB so the scheduled timeout handler skips
  // cleanly instead of sending a spurious "All players voted" message.
  try {
    await resolveRound.run({ game_id: gameId, round, phase }, dbConn);
  } catch (err) {
    // Non-fatal — the timeout will still set resolved=TRUE when it fires.
    console.warn(
      `[vote-resolver] Could not mark round resolved in DB game=${gameId}:`,
      err,
    );
  }

  // Check win condition and submit forceEndGame if game is over
  if (bundles.length > 0) {
    const postAlive = new Set(aliveIndices);
    if (tally.hasElimination) postAlive.delete(tally.targetIdx);

    const aliveWolves = bundles.filter(
      (b) => b.role === 1 && postAlive.has(b.playerId),
    ).length;
    const aliveVillagers = bundles.filter(
      (b) => b.role !== 1 && postAlive.has(b.playerId),
    ).length;

    const isDraw = aliveWolves === 0 && aliveVillagers === 0;
    const gameOver = isDraw || aliveWolves === 0 || aliveWolves >= aliveVillagers;
    if (gameOver) {
      const winner = isDraw ? "DRAW" : aliveWolves === 0 ? "VILLAGERS" : "WEREWOLVES";
      console.log(
        `[vote-resolver] Game over (ledger): wolves=${aliveWolves} villagers=${aliveVillagers}` +
          ` winner=${winner} — submitting forceEndGame for game=${gameId}`,
      );
      try {
        await callMidnightCircuit({
          circuitId: "forceEndGame",
          privateState: emptyPrivateState,
          batcherUrl: BATCHER_URL,
          seed: adminWalletSeed,
          callFn: async (contract) => {
            await contract.callTx.forceEndGame(
              BigInt(gameId),
              secrets!.masterSecret,
            );
          },
        });
        console.log(
          `[vote-resolver] forceEndGame (ledger) submitted game=${gameId} winner=${winner}`,
        );
      } catch (err) {
        console.error(
          `[vote-resolver] forceEndGame (ledger) failed for game=${gameId}:`,
          err,
        );
      }
    }
  }

  return tally;
}

// ---------------------------------------------------------------------------
// Backend-API-based resolution (original path via /api/submit_vote)
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
  const roundActionsDigest = buildRoundActionsDigestFromStore(
    gameId,
    round,
    phase,
  );

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
          roundActionsDigest,
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
          roundActionsDigest,
        );
      },
    });
  }

  console.log(
    `[vote-resolver] Phase resolution submitted for game=${gameId} round=${round} phase=${phase}`,
  );

  // Parity / win detection: compute post-elimination alive counts from bundles
  // and call forceEndGame if the game is over.
  //
  // The contract's resolveNightPhase / resolveDayPhase never set phase=Finished
  // because they don't know player roles (committed, not revealed). We detect
  // game-end here using the in-memory bundles that record each player's role.
  const bundles = store.getAllBundlesForGame(gameId);
  if (bundles.length > 0) {
    const postAlive = new Set(aliveIndices);
    if (tally.hasElimination) postAlive.delete(tally.targetIdx);

    const aliveWolves = bundles.filter(
      (b) => b.role === 1 && postAlive.has(b.playerId),
    ).length;
    const aliveVillagers = bundles.filter(
      (b) => b.role !== 1 && postAlive.has(b.playerId),
    ).length;

    const isDraw = aliveWolves === 0 && aliveVillagers === 0;
    const gameOver = isDraw || aliveWolves === 0 || aliveWolves >= aliveVillagers;
    if (gameOver) {
      const winner = isDraw ? "DRAW" : aliveWolves === 0 ? "VILLAGERS" : "WEREWOLVES";
      console.log(
        `[vote-resolver] Game over detected: wolves=${aliveWolves} villagers=${aliveVillagers}` +
          ` winner=${winner} — submitting forceEndGame for game=${gameId}`,
      );
      try {
        await callMidnightCircuit({
          circuitId: "forceEndGame",
          privateState: emptyPrivateState,
          batcherUrl: BATCHER_URL,
          seed: adminWalletSeed,
          callFn: async (contract) => {
            // secrets is non-null here: adminWalletSeed is derived from it and
            // was checked above; if secrets were undefined we'd have thrown.
            await contract.callTx.forceEndGame(
              BigInt(gameId),
              secrets!.masterSecret,
            );
          },
        });
        console.log(
          `[vote-resolver] forceEndGame submitted for game=${gameId} — winner=${winner}`,
        );
      } catch (err) {
        console.error(
          `[vote-resolver] forceEndGame failed for game=${gameId}:`,
          err,
        );
      }
    }
  } else {
    console.warn(
      `[vote-resolver] No bundles for game=${gameId} — skipping parity check`,
    );
  }

  return tally;
}
