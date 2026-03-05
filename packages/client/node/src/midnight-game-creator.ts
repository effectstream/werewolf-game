/**
 * Creates a Midnight game on-chain via delegated balancing.
 *
 * Follows the party-a-delegated.ts pattern:
 * 1. Build wallet facade (provides coin/encryption keys)
 * 2. Create intercepting providers (capture serialized tx, abort submission)
 * 3. Connect to the deployed werewolf contract via findDeployedContract
 * 4. Set up private state with SetupData for the circuit witnesses
 * 5. Call the createGame circuit — interceptor captures the tx
 * 6. POST the serialized tx to the batcher for balancing/submission
 */

import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { Contract as WerewolfContract } from "../../../shared/contracts/midnight/contract-werewolf/src/managed/contract/index.js";
import {
  witnesses,
  type PrivateState,
} from "../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  assertIsContractAddress,
  toHex,
} from "@midnight-ntwrk/midnight-js-utils";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  buildWalletFacade,
  type NetworkUrls,
  type WalletResult,
} from "@paimaexample/midnight-contracts";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import type { FinalizedTransaction } from "@midnight-ntwrk/ledger-v7";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PLAYERS = 16;
const DELEGATED_SENTINEL =
  "Delegated balancing flow handed off to batcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PRIVATE_STATE_ID = "werewolfNodePrivateState";

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
}

class DelegatedBalancingSentError extends Error {
  constructor() {
    super(DELEGATED_SENTINEL);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRandomSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isDelegationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  let current: Error | undefined = error;
  while (current) {
    if (current.message.includes(DELEGATED_SENTINEL)) return true;
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return false;
}

/**
 * Resolve the path to the managed directory containing zkir/keys.
 */
function getManagedPath(): string {
  return resolve(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "shared",
    "contracts",
    "midnight",
    "contract-werewolf",
    "src",
    "managed",
  );
}

// ---------------------------------------------------------------------------
// Provider creation (intercepting pattern)
// ---------------------------------------------------------------------------

function createProviders(params: {
  walletResult: WalletResult;
  gameId: bigint;
  networkUrls: NetworkUrls;
  onSerializedTx: (serialized: string) => void;
}): any {
  const { walletResult, gameId, networkUrls, onSerializedTx } = params;
  const managedPath = getManagedPath();

  const interceptingProvider: WalletProvider & MidnightProvider = {
    getCoinPublicKey() {
      return walletResult.zswapSecretKeys.coinPublicKey;
    },
    getEncryptionPublicKey() {
      return walletResult.zswapSecretKeys.encryptionPublicKey;
    },
    balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
      console.log(
        "[midnight-game-creator] Capturing FinalizedTransaction...",
      );
      const bound = tx.bind();
      const serialized = toHex(bound.serialize());
      console.log(
        "[midnight-game-creator] Serialized tx hex length:",
        serialized.length,
      );
      onSerializedTx(serialized);
      return Promise.resolve(bound);
    },
    submitTx() {
      throw new DelegatedBalancingSentError();
    },
  };

  const zkConfigProvider = new NodeZkConfigProvider<any>(managedPath);

  const privateStateStoreName = `node-werewolf-ps-${gameId}`;
  const midnightDbName = `midnight-level-db-node-${gameId}`;

  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName,
      privateStateStoreName,
      walletProvider: interceptingProvider,
    } as any),
    publicDataProvider: indexerPublicDataProvider(
      networkUrls.indexer!,
      networkUrls.indexerWS!,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      networkUrls.proofServer!,
      zkConfigProvider,
    ),
    walletProvider: interceptingProvider,
    midnightProvider: interceptingProvider,
  };
}

// ---------------------------------------------------------------------------
// Private state setup
// ---------------------------------------------------------------------------

function buildInitialPrivateState(
  params: CreateMidnightGameParams,
): PrivateState {
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

  return {
    setupData: new Map([
      [
        key,
        {
          roleCommitments,
          encryptedRoles,
          adminKey: { bytes: params.adminSignPublicKey },
          adminVotePublicKey: { bytes: adminVoteBytes },
          initialRoot: params.merkleRoot,
        },
      ],
    ]),
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Create a Midnight game via the delegated balancing pattern.
 *
 * 1. Builds a throwaway wallet facade (only needs coin/encryption keys)
 * 2. Connects to the deployed werewolf contract
 * 3. Evaluates the createGame circuit locally
 * 4. Captures the serialized transaction
 * 5. Posts it to the batcher for balancing and on-chain submission
 */
export async function createMidnightGame(
  params: CreateMidnightGameParams,
): Promise<void> {
  const { gameId, batcherUrl } = params;

  console.log(
    `[midnight-game-creator] Creating Midnight game ${gameId} via delegated balancing`,
  );

  // 1. Set network ID
  setNetworkId(midnightNetworkConfig.id as any);

  // 2. Get contract address
  const { contractAddress } = readMidnightContract("contract-werewolf", {
    networkId: midnightNetworkConfig.id,
  });
  console.log(
    `[midnight-game-creator] Contract address: ${contractAddress}`,
  );

  // 3. Build wallet facade with a random seed (we only need keys, not funds)
  const seed = createRandomSeed();
  const networkUrls: NetworkUrls = {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  };

  const walletResult = await buildWalletFacade(
    networkUrls as Required<NetworkUrls>,
    seed,
    midnightNetworkConfig.id,
  );

  // 4. Create intercepting providers
  let serializedTx: string | null = null;
  const providers = createProviders({
    walletResult,
    gameId,
    networkUrls,
    onSerializedTx: (serialized) => {
      serializedTx = serialized;
    },
  });

  // 5. Build compiled contract
  const managedPath = getManagedPath();
  // The Midnight SDK generics are deeply nested and don't align well with
  // the delegated-balancing intercepting pattern, so we escape to `any`.
  const compiledContract: any = CompiledContract.make(
    "contract-werewolf",
    WerewolfContract as any,
  ).pipe(
    (CompiledContract as any).withWitnesses(witnesses),
    (CompiledContract as any).withCompiledFileAssets(managedPath),
  );

  // 6. Connect to deployed contract with initial private state
  const initialPrivateState = buildInitialPrivateState(params);

  assertIsContractAddress(contractAddress as ContractAddress);
  const werewolfContract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: compiledContract as any,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  });

  // 7. Call createGame circuit — interceptor captures the tx
  console.log(
    `[midnight-game-creator] Calling createGame circuit for game ${gameId}...`,
  );

  // Pad admin vote public key to 33 bytes for the circuit argument
  let adminVotePublicKeyBytes = params.adminVotePublicKey;
  if (adminVotePublicKeyBytes.length < 33) {
    const padded = new Uint8Array(33);
    padded.set(adminVotePublicKeyBytes);
    adminVotePublicKeyBytes = padded;
  }

  try {
    await (werewolfContract.callTx as any).createGame(
      gameId,
      adminVotePublicKeyBytes,
      params.masterSecretCommitment,
      params.actualCount,
      params.werewolfCount,
    );
  } catch (error) {
    if (isDelegationError(error)) {
      console.log(
        "[midnight-game-creator] Transaction captured via delegation.",
      );
    } else {
      throw error;
    }
  }

  if (!serializedTx) {
    throw new Error(
      `[midnight-game-creator] Failed to capture serialized transaction for game ${gameId}`,
    );
  }

  // 8. Post to batcher
  console.log(
    `[midnight-game-creator] Posting to batcher at ${batcherUrl}/send-input...`,
  );

  const body = {
    data: {
      target: "midnight_balancing",
      address: "moderator_trusted_node",
      addressType: 0,
      input: JSON.stringify({
        tx: serializedTx,
        txStage: "finalized",
        circuitId: "createGame",
      }),
      timestamp: Date.now(),
    },
    confirmationLevel: "wait-receipt",
  };

  const response = await fetch(`${batcherUrl}/send-input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[midnight-game-creator] Batcher rejected transaction (HTTP ${response.status}): ${text}`,
    );
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(
      `[midnight-game-creator] Batcher failed: ${result.message}`,
    );
  }

  console.log(
    `[midnight-game-creator] Game ${gameId} createGame submitted successfully via batcher`,
  );
}
