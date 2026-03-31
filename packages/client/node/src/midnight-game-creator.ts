/**
 * Creates a Midnight game on-chain via delegated balancing.
 *
 * Uses the factory pattern: privateState is a function that receives the
 * wallet's ZSwap coin public key so adminKey can be set for encryption.
 * callMidnightCircuit generates the wallet, calls the factory, then connects
 * to the contract — resolving the chicken-and-egg dependency cleanly.
 *
 * Admin authorization uses a ZK secret commitment (adminSecretCommitment)
 * instead of wallet identity. The adminWalletSeed is still used for delegated
 * balancing but no longer for on-chain authorization.
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
  /** Field commitment of adminSecret — stored on-chain for ZK admin authorization. */
  adminSecretCommitment: bigint;
  masterSecretCommitment: Uint8Array;
  actualCount: bigint;
  werewolfCount: bigint;
  roleCommitments: Uint8Array[];
  merkleRoot: { field: bigint };
  batcherUrl: string;
  /** Deterministic admin wallet seed (64-char hex) for delegated balancing. */
  seed?: string;
}

export interface CreateMidnightGameResult {
  /** Seed used to build the admin wallet facade for delegated balancing. */
  adminWalletSeed: string;
  /** ZSwap coin public key from the wallet facade. */
  adminCoinPublicKey: Uint8Array;
}

// ---------------------------------------------------------------------------
// Private state factory
// ---------------------------------------------------------------------------

/**
 * Returns a factory that receives the wallet's ZSwap coin public key and
 * builds the initial private state for createGame. Using a factory (rather than
 * a concrete PrivateState) breaks the circular dependency: we need the coin
 * key for encryption setup, but the coin key is only known after building the wallet.
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
          adminKey: { bytes: coinPublicKey },
          adminVotePublicKey: { bytes: adminVoteBytes },
          initialRoot: params.merkleRoot,
        },
      ],
    ]),
    adminSecrets: new Map(), // createGame doesn't call wit_getAdminSecret
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
    // Factory receives the wallet's coin public key for encryption setup
    privateState: makePrivateStateFactory(params),
    batcherUrl,
    seed: params.seed,
    callFn: async (contract) => {
      await contract.callTx.createGame(
        gameId,
        adminVotePublicKeyBytes,
        params.adminSecretCommitment,
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
