/**
 * Creates a Midnight game on-chain via delegated balancing.
 *
 * Uses the factory pattern: privateState is a function that receives the
 * wallet's ZSwap coin public key so it can be stored as adminKey on-chain.
 * callMidnightCircuit generates the wallet, calls the factory, then connects
 * to the contract — resolving the chicken-and-egg dependency cleanly.
 *
 * The returned adminWalletSeed MUST be stored in GameSecrets and reused for
 * all subsequent admin circuits (resolveNightPhase, resolveDayPhase, etc.)
 * which check std_ownPublicKey() == state.adminKey.
 */

import type { PrivateState } from "../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";
import { callMidnightCircuit } from "./midnight-circuit-caller.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PLAYERS = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateMidnightGameParams {
  gameId: bigint;
  adminVotePublicKey: Uint8Array;
  adminSignPublicKey: Uint8Array;
  masterSecretCommitment: Uint8Array;
  actualCount: bigint;
  werewolfCount: bigint;
  roleCommitments: Uint8Array[];
  merkleRoot: { field: bigint };
  batcherUrl: string;
  /** Deterministic admin wallet seed (64-char hex). When provided the same
   *  ZSwap coin identity is always produced, so std_ownPublicKey() will keep
   *  matching state.adminKey after a server restart. */
  seed?: string;
}

export interface CreateMidnightGameResult {
  /** Seed used to build the admin wallet facade. Must be stored and reused for all
   *  subsequent admin circuit calls (resolveNightPhase, resolveDayPhase, etc.) so that
   *  std_ownPublicKey() matches the adminKey stored on-chain. */
  adminWalletSeed: string;
  /** ZSwap coin public key stored on-chain as GameState.adminKey. */
  adminCoinPublicKey: Uint8Array;
}

// ---------------------------------------------------------------------------
// Private state factory
// ---------------------------------------------------------------------------

/**
 * Returns a factory that receives the wallet's ZSwap coin public key and
 * builds the initial private state for createGame. Using a factory (rather than
 * a concrete PrivateState) breaks the circular dependency: we need the coin
 * key to set adminKey, but the coin key is only known after building the wallet.
 */
function makePrivateStateFactory(
  params: CreateMidnightGameParams,
): (coinPublicKey: Uint8Array) => PrivateState {
  const key = String(params.gameId);

  // Pad roleCommitments to MAX_PLAYERS (circuit expects fixed-size array)
  const roleCommitments = [...params.roleCommitments];
  while (roleCommitments.length < MAX_PLAYERS) {
    roleCommitments.push(new Uint8Array(32));
  }

  // Encrypted roles are not needed for createGame — use empty placeholders
  const encryptedRoles = Array.from(
    { length: MAX_PLAYERS },
    () => new Uint8Array(3),
  );

  // Pad admin vote public key to 33 bytes if needed
  let adminVoteBytes = params.adminVotePublicKey;
  if (adminVoteBytes.length < 33) {
    const padded = new Uint8Array(33);
    padded.set(adminVoteBytes);
    adminVoteBytes = padded;
  }

  return (coinPublicKey: Uint8Array): PrivateState => ({
    setupData: new Map([
      [
        key,
        {
          roleCommitments,
          encryptedRoles,
          // Use the wallet's ZSwap coin key as adminKey — subsequent admin circuits
          // (resolveNightPhase, resolveDayPhase) rebuild the same wallet from
          // adminWalletSeed so std_ownPublicKey() matches.
          adminKey: { bytes: coinPublicKey },
          adminVotePublicKey: { bytes: adminVoteBytes },
          initialRoot: params.merkleRoot,
        },
      ],
    ]),
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Create a Midnight game via the delegated balancing pattern.
 *
 * Returns adminWalletSeed and adminCoinPublicKey — the caller MUST store
 * adminWalletSeed in GameSecrets so it can be passed to resolve circuits.
 */
export async function createMidnightGame(
  params: CreateMidnightGameParams,
): Promise<CreateMidnightGameResult> {
  const { gameId, batcherUrl } = params;

  console.log(
    `[midnight-game-creator] Creating Midnight game ${gameId} via delegated balancing`,
  );

  // Pad admin vote public key to 33 bytes for the circuit argument
  let adminVotePublicKeyBytes = params.adminVotePublicKey;
  if (adminVotePublicKeyBytes.length < 33) {
    const padded = new Uint8Array(33);
    padded.set(adminVotePublicKeyBytes);
    adminVotePublicKeyBytes = padded;
  }

  const result = await callMidnightCircuit({
    circuitId: "createGame",
    // Factory receives the wallet's coin public key so adminKey is set correctly
    privateState: makePrivateStateFactory(params),
    batcherUrl,
    seed: params.seed,
    callFn: async (contract) => {
      await contract.callTx.createGame(
        gameId,
        adminVotePublicKeyBytes,
        params.masterSecretCommitment,
        params.actualCount,
        params.werewolfCount,
      );
    },
  });

  console.log(
    `[midnight-game-creator] Game ${gameId} createGame submitted. Seed stored for admin reuse.`,
  );

  return {
    adminWalletSeed: result.seed,
    adminCoinPublicKey: result.coinPublicKey,
  };
}
