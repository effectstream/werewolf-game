/**
 * Generalized delegated balancing pattern for calling Midnight contract circuits.
 *
 * Extracts the common pattern from midnight-game-creator.ts:
 * 1. Build wallet facade (provides coin/encryption keys)
 * 2. Create intercepting providers (capture serialized tx, abort submission)
 * 3. Connect to the deployed werewolf contract via findDeployedContract
 * 4. Call the circuit — interceptor captures the UnboundTransaction at balanceTx
 * 5. POST the serialized UnboundTransaction to the batcher (txStage "unbound") for dust balancing and submission
 */

import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { Contract as WerewolfContract } from "../../../shared/contracts/midnight/contract-werewolf/src/managed/contract/index.js";
import {
  type PrivateState,
  witnesses,
} from "../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import {
  findDeployedContract,
  getPublicStates,
} from "@midnight-ntwrk/midnight-js-contracts";
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
} from "@effectstream/midnight-contracts";
import { readMidnightContract } from "@effectstream/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@effectstream/midnight-contracts/midnight-env";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { resolve } from "node:path";
import {
  WerewolfLedger,
  type WerewolfVoteEntry,
} from "../../../shared/utils/werewolf-ledger.ts";
import { convertMidnightLedger } from "../../../shared/utils/paima-utils.ts";
import { normalizeMidnightLedgerStateInput } from "../../../shared/utils/paima-utils.ts";
import { ledger as contractLedger } from "../../../shared/contracts/midnight/contract-werewolf/src/managed/contract/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DELEGATED_SENTINEL = "Delegated balancing flow handed off to batcher";

const PRIVATE_STATE_ID = "werewolfNodePrivateState";

// Timeouts — prevent indefinite hangs that wedge the resolution guard.
// Indexer reads (findDeployedContract, getPublicStates, buildWalletFacade)
// are given a short leash; the batcher POST (wait-receipt) gets longer
// because normal tx confirmation takes 20-90s on Midnight.
const WALLET_FACADE_TIMEOUT_MS = 15_000;
const FIND_CONTRACT_TIMEOUT_MS = 15_000;
const BATCHER_POST_TIMEOUT_MS = 60_000;
const GET_STATES_TIMEOUT_MS = 15_000;

/**
 * Reject if `promise` doesn't settle within `ms`. Always clears the timer in a
 * `finally`, so when the real promise wins we don't leave a dangling timer that
 * keeps the event loop alive and rejects an already-settled promise.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallMidnightCircuitParams {
  /** Circuit identifier used in the batcher payload. */
  circuitId: string;
  /**
   * Private state for witness evaluation, OR a factory that receives the wallet's
   * coin public key so it can be embedded into the private state (used for
   * encryption key setup during createGame).
   */
  privateState: PrivateState | ((coinPublicKey: Uint8Array) => PrivateState);
  /**
   * Function that calls the desired circuit on the connected contract.
   * The contract uses `callTx` methods. The intercepting provider will
   * capture the serialized transaction and throw the delegation sentinel.
   */
  callFn: (contract: any) => Promise<void>;
  /** Batcher URL (e.g. "http://localhost:3334"). */
  batcherUrl: string;
  /**
   * Optional wallet seed (32-byte hex). If provided, the same wallet identity
   * is used across calls for delegated balancing. If omitted, a fresh random
   * seed is generated.
   */
  seed?: string;
}

class DelegatedBalancingSentError extends Error {
  constructor() {
    super(DELEGATED_SENTINEL);
  }
}

// ---------------------------------------------------------------------------
// Helpers (exported for reuse by midnight-game-creator.ts)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

export function createRandomSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isDelegationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  let current: Error | undefined = error;
  while (current) {
    if (current.message.includes(DELEGATED_SENTINEL)) return true;
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return false;
}

export function getManagedPath(): string {
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

function getPrivateStoragePassword(): string {
  const password = process.env["MIDNIGHT_STORAGE_PASSWORD"];
  if (!password) {
    return "WwDev_7c4mRHDsRvczTaSEHj8l";
  }
  if (password.length < 16) {
    throw new Error(
      "MIDNIGHT_STORAGE_PASSWORD must be at least 16 characters long.",
    );
  }
  return password;
}

function createProviders(params: {
  walletResult: WalletResult;
  label: string;
  networkUrls: NetworkUrls;
  onSerializedTx: (serialized: string) => void;
}): any {
  const { walletResult, label, networkUrls, onSerializedTx } = params;
  const managedPath = getManagedPath();
  const accountId = (walletResult as any).unshieldedKeystore
    ?.getBech32Address?.()
    ?.asString?.() ??
    String((walletResult as any).zswapSecretKeys?.coinPublicKey ?? label);

  const interceptingProvider: WalletProvider & MidnightProvider = {
    getCoinPublicKey() {
      return walletResult.zswapSecretKeys.coinPublicKey;
    },
    getEncryptionPublicKey() {
      return walletResult.zswapSecretKeys.encryptionPublicKey;
    },
    balanceTx(tx: UnboundTransaction, _ttl?: Date) {
      // Serialize the UnboundTransaction directly — no empty bind().
      // The batcher receives it as txStage "unbound" and calls
      // balanceUnboundTransaction() to add dust and produce a single
      // cohesive FinalizedTransaction, rather than an empty-commitment bind
      // followed by a separate merged balancing transaction.
      const serialized = toHex((tx as any).serialize());
      console.log(
        `[midnight-circuit] [${label}] Captured UnboundTransaction hex length:`,
        serialized.length,
      );
      onSerializedTx(serialized);
      throw new DelegatedBalancingSentError(); // abort SDK pipeline immediately
    },
    submitTx() {
      throw new DelegatedBalancingSentError();
    },
  };

  const zkConfigProvider = new NodeZkConfigProvider<any>(managedPath);

  const privateStateStoreName = `node-werewolf-ps-${label}`;
  const midnightDbName = `midnight-level-db-node-${label}`;

  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName,
      privateStateStoreName,
      privateStoragePasswordProvider: () => getPrivateStoragePassword(),
      accountId,
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
// Main export
// ---------------------------------------------------------------------------

export interface CallMidnightCircuitResult {
  /** The seed that was used for the wallet facade (random or provided). */
  seed: string;
  /** The ZSwap coin public key from the wallet facade. */
  coinPublicKey: Uint8Array;
}

// Serialize all circuit calls so only one indexerPublicDataProvider WebSocket
// is open at a time. Concurrent WebSocket connections to the Midnight indexer
// (one per callMidnightCircuit + effectstream's own sync connection) can
// disrupt effectstream's block stream, causing the node to hang.
let _circuitQueue: Promise<void> = Promise.resolve();

/**
 * Call a Midnight contract circuit via the delegated balancing pattern.
 *
 * 1. Builds a wallet facade (reusing provided seed, or fresh random one)
 * 2. Connects to the deployed werewolf contract
 * 3. Evaluates the circuit locally via `callFn`
 * 4. Captures the serialized transaction
 * 5. Posts it to the batcher for balancing and on-chain submission
 *
 * Returns the seed and coin public key used, so callers can persist them for
 * subsequent circuit calls (delegated balancing).
 *
 * Calls are serialized through a shared queue to avoid concurrent WebSocket
 * connections to the Midnight indexer interfering with effectstream's sync.
 */
export function callMidnightCircuit(
  params: CallMidnightCircuitParams,
): Promise<CallMidnightCircuitResult> {
  let releaseSlot!: () => void;
  const slot = new Promise<void>((r) => (releaseSlot = r));
  const prev = _circuitQueue;
  _circuitQueue = slot;
  return prev.then(() => _callMidnightCircuit(params)).finally(releaseSlot);
}

async function _callMidnightCircuit(
  params: CallMidnightCircuitParams,
): Promise<CallMidnightCircuitResult> {
  const { circuitId, callFn, batcherUrl } = params;

  console.log(
    `[midnight-circuit] Calling circuit "${circuitId}" via delegated balancing`,
  );

  // 1. Set network ID
  setNetworkId(midnightNetworkConfig.id as any);

  // 2. Get contract address
  const { contractAddress } = readMidnightContract("contract-werewolf", {
    networkId: midnightNetworkConfig.id,
  });

  // 3. Build wallet facade — reuse provided seed for admin calls, generate fresh for createGame
  const seed = params.seed ?? createRandomSeed();
  const networkUrls: NetworkUrls = {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  };

  const walletResult = await withTimeout(
    buildWalletFacade(
      networkUrls as Required<NetworkUrls>,
      seed,
      midnightNetworkConfig.id,
    ),
    WALLET_FACADE_TIMEOUT_MS,
    "[midnight-circuit] buildWalletFacade",
  );

  // 4. Resolve private state — if a factory was provided, call it with the coin public key
  // so the factory can embed the coin key (e.g. for encryption setup in createGame).
  // zswapSecretKeys.coinPublicKey is a hex string; convert to Uint8Array for the factory.
  const coinPublicKeyHex = walletResult.zswapSecretKeys.coinPublicKey as string;
  const coinPublicKey = hexToBytes(coinPublicKeyHex);
  const resolvedPrivateState = typeof params.privateState === "function"
    ? params.privateState(coinPublicKey)
    : params.privateState;

  // 5. Create intercepting providers
  let serializedTx: string | null = null;
  const label = `${circuitId}-${Date.now()}`;
  const providers = createProviders({
    walletResult,
    label,
    networkUrls,
    onSerializedTx: (serialized) => {
      serializedTx = serialized;
    },
  });

  // 6. Build compiled contract
  const managedPath = getManagedPath();
  let compiledContract: any = CompiledContract.make(
    "contract-werewolf",
    WerewolfContract as any,
  );
  compiledContract = (CompiledContract as any).withWitnesses(
    compiledContract,
    witnesses,
  );
  compiledContract = (CompiledContract as any).withCompiledFileAssets(
    compiledContract,
    managedPath,
  );

  // 7. Connect to deployed contract with resolved private state
  assertIsContractAddress(contractAddress as ContractAddress);
  const werewolfContract = await withTimeout(
    findDeployedContract(providers, {
      contractAddress,
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: resolvedPrivateState,
    }),
    FIND_CONTRACT_TIMEOUT_MS,
    "[midnight-circuit] findDeployedContract",
  );

  // 8. Call the circuit — interceptor captures the tx
  try {
    await callFn(werewolfContract);
  } catch (error) {
    if (isDelegationError(error)) {
      console.log(
        `[midnight-circuit] [${circuitId}] Transaction captured via delegation.`,
      );
    } else {
      throw error;
    }
  }

  if (!serializedTx) {
    throw new Error(
      `[midnight-circuit] Failed to capture serialized transaction for circuit "${circuitId}"`,
    );
  }

  // 8. Post to batcher
  console.log(
    `[midnight-circuit] Posting "${circuitId}" to batcher at ${batcherUrl}/send-input...`,
  );

  const body = {
    data: {
      target: "midnight_balancing",
      address: "moderator_trusted_node",
      addressType: 0,
      input: JSON.stringify({
        tx: serializedTx,
        txStage: "unbound",
        circuitId,
      }),
      timestamp: Date.now(),
    },
    confirmationLevel: "wait-receipt",
  };

  const controller = new AbortController();
  const batcherTimeout = setTimeout(
    () => controller.abort(),
    BATCHER_POST_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(`${batcherUrl}/send-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `[midnight-circuit] Batcher POST timed out after ${BATCHER_POST_TIMEOUT_MS}ms for circuit "${circuitId}"`,
      );
    }
    throw err;
  } finally {
    clearTimeout(batcherTimeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `[midnight-circuit] Batcher rejected "${circuitId}" (HTTP ${response.status}): ${text}`,
    );
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(
      `[midnight-circuit] Batcher failed for "${circuitId}": ${result.message}`,
    );
  }

  console.log(
    `[midnight-circuit] Circuit "${circuitId}" submitted successfully via batcher`,
  );

  return {
    seed,
    coinPublicKey, // already Uint8Array, converted from zswapSecretKeys.coinPublicKey hex
  };
}

// ---------------------------------------------------------------------------
// Ledger read helper
// ---------------------------------------------------------------------------

/**
 * Fetch encrypted votes for a given (gameId, round, phase) directly from the
 * live Midnight ledger via the indexer.  Used by the round-timeout handler so
 * it can call resolvePhaseFromLedger() with up-to-date on-chain vote data even
 * when a partial vote set triggered the timeout.
 */
export async function fetchCurrentLedgerVotes(
  gameId: number,
  round: number,
  phase: string,
): Promise<WerewolfVoteEntry[]> {
  setNetworkId(midnightNetworkConfig.id as any);
  const { contractAddress } = readMidnightContract("contract-werewolf", {
    networkId: midnightNetworkConfig.id,
  });
  const dataProvider = indexerPublicDataProvider(
    midnightNetworkConfig.indexer!,
    midnightNetworkConfig.indexerWS!,
  );
  assertIsContractAddress(contractAddress as ContractAddress);
  const { contractState } = await withTimeout(
    getPublicStates(
      dataProvider,
      contractAddress as ContractAddress,
    ),
    GET_STATES_TIMEOUT_MS,
    "[fetchCurrentLedgerVotes] getPublicStates",
  );
  // Apply the same ledger() + convertMidnightLedger() pipeline used in config.ts
  // so that Midnight Map-like objects are converted to plain objects that
  // WerewolfLedger.parseMap() can iterate correctly.
  const typedLedger = contractLedger(
    normalizeMidnightLedgerStateInput(contractState),
  );
  const converted = convertMidnightLedger(typedLedger);
  const werewolfLedger = WerewolfLedger.from(converted);
  const votes = werewolfLedger.getVoteEntriesForRoundAndPhase(
    gameId,
    round,
    phase,
  );
  console.log(
    `[fetchCurrentLedgerVotes] game=${gameId} round=${round} phase=${phase} → ${votes.length} vote(s) in live ledger`,
  );
  return votes;
}
