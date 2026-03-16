/**
 * Player vote on-chain submission via Lace wallet + Midnight batcher.
 *
 * Players call nightAction/voteDay circuits directly using their own Lace
 * wallet identity. The transaction is intercepted at balanceTx and sent to the
 * batcher for proof generation and on-chain submission.
 *
 * Flow:
 *   1. Fetch Midnight network config from the backend (/api/midnight_config)
 *   2. Build a WalletProvider + MidnightProvider wrapping the Lace DApp connector
 *   3. Join the deployed contract via findDeployedContract (reads indexer state)
 *   4. Use BatcherClient to call nightAction / voteDay
 *   5. BatcherClient intercepts balanceTx, serialises the unbound tx, POSTs to batcher
 *   6. STF detects the on-chain vote via roundVotes ledger map → triggers resolution
 */

import {
  Contract as WerewolfContract,
  pureCircuits,
} from "../../../shared/contracts/midnight/contract-werewolf/src/managed/contract/index.js";
import { witnesses } from "../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";
import {
  BatcherClient,
  DELEGATED_SENTINEL,
} from "../../../shared/utils/batcher-client.ts";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { toHex } from "@midnight-ntwrk/compact-runtime";
import nacl from "tweetnacl";
import { midnightWallet } from "./midnightWallet.ts";
import type { PlayerBundle } from "../state/gameState.ts";
import type { PrivateState } from "../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:9999";

const BATCHER_URL = (import.meta.env.VITE_BATCHER_URL as string | undefined) ??
  "http://localhost:3334";

interface MidnightConfig {
  contractAddress: string;
  networkId: string;
  indexerUrl: string;
  indexerWsUrl: string;
  proofServerUrl: string;
}

let _cachedConfig: MidnightConfig | null = null;

// ---------------------------------------------------------------------------
// Module-level singletons — avoids re-fetching ZK keys on every vote
// ---------------------------------------------------------------------------

let _zkConfigProvider: FetchZkConfigProvider | null = null;
let _compiledContract: any = null;
let _privateStateProvider: any = null;
let _publicDataProvider: any = null;

function getZkConfigProvider(): FetchZkConfigProvider {
  if (!_zkConfigProvider) {
    _zkConfigProvider = new FetchZkConfigProvider(
      window.location.origin,
      fetch.bind(globalThis),
    );
  }
  return _zkConfigProvider;
}

function getCompiledContract(): any {
  if (!_compiledContract) {
    _compiledContract = (CompiledContract.withCompiledFileAssets as any)(
      (CompiledContract.withWitnesses as any)(
        CompiledContract.make("contract-werewolf", WerewolfContract),
        witnesses,
      ),
      window.location.origin,
    );
  }
  return _compiledContract;
}

function getPrivateStateProvider(): any {
  if (!_privateStateProvider) {
    _privateStateProvider = levelPrivateStateProvider({
      privateStoragePasswordProvider: async () => "PAIMA_VOTE_STORAGE_PASSWORD",
    } as any);
  }
  return _privateStateProvider;
}

function getPublicDataProvider(config: MidnightConfig): any {
  if (!_publicDataProvider) {
    _publicDataProvider = indexerPublicDataProvider(
      config.indexerUrl,
      config.indexerWsUrl,
    );
  }
  return _publicDataProvider;
}


async function getMidnightConfig(): Promise<MidnightConfig> {
  if (_cachedConfig) return _cachedConfig;
  const res = await fetch(`${API_BASE}/api/midnight_config`);
  if (!res.ok) {
    throw new Error(
      `[playerVoteContract] Failed to fetch Midnight config: ${res.status}`,
    );
  }
  _cachedConfig = (await res.json()) as MidnightConfig;
  return _cachedConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// PrivateState construction
// ---------------------------------------------------------------------------

/**
 * Build the PrivateState for a player vote circuit call.
 *
 * - Uses pureCircuits.testComputeHash to derive the Merkle leaf hash from
 *   leafSecret (no blockchain connection required — pure WASM function).
 * - Converts merklePath sibling fields from strings to bigints.
 * - Sets nextAction so wit_getActionData returns the encrypted vote payload.
 */
function buildVotePrivateState(
  bundle: PlayerBundle,
  gameId: number,
  targetIndex: number,
): PrivateState {
  const leafSecretBytes = hexToBytes(bundle.leafSecret);

  // Compute the Merkle leaf hash using the pure circuit (no ZK proof needed)
  const leafHash = new Uint8Array(
    pureCircuits.testComputeHash(leafSecretBytes),
  );

  // Reconstruct full MerkleTreePath (leaf + path entries with bigint fields)
  const merklePath = {
    leaf: leafHash,
    path: bundle.merklePath.map((entry) => ({
      sibling: { field: BigInt(entry.sibling.field) },
      goes_left: entry.goes_left,
    })),
  };

  // adminVotePublicKey is 33 bytes; NaCl ECDH requires 32 bytes
  const adminVotePublicKeyBytes = hexToBytes(bundle.adminVotePublicKeyHex);

  return {
    setupData: new Map([
      [
        String(gameId),
        {
          adminVotePublicKey: { bytes: adminVotePublicKeyBytes.slice(0, 32) },
          adminKey: { bytes: new Uint8Array(32) }, // unused in vote circuits
          initialRoot: { field: 0n }, // unused in vote circuits
          roleCommitments: [],
          encryptedRoles: [],
        },
      ],
    ]),
    // The player's leaf secret is used as their Curve25519 private key for vote encryption
    encryptionKeypair: {
      secretKey: leafSecretBytes,
      publicKey: nacl.scalarMult.base(leafSecretBytes),
    },
    nextAction: {
      targetNumber: targetIndex,
      random: Math.floor(Math.random() * 1000),
      merklePath,
      leafSecret: leafSecretBytes,
    },
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Submit a player vote directly to the Midnight contract.
 *
 * The vote is encrypted inside the circuit (via wit_getActionData), bundled
 * into an unbound transaction (proof generated by proofProvider before balanceTx),
 * intercepted at balanceTx, and forwarded to the batcher for dust balancing and
 * on-chain submission.
 *
 * The STF (state-machine.ts → midnightContractState) detects the new nullifier
 * in Werewolf_voteNullifiers and triggers phase resolution when all votes are in.
 */
export async function submitVoteOnChain(
  bundle: PlayerBundle,
  targetIndex: number,
  round: number,
  phase: string,
  gameId: number,
): Promise<void> {
  console.log(
    `[playerVoteContract] Submitting ${phase} vote on-chain: game=${gameId} round=${round} target=${targetIndex}`,
  );

  const config = await getMidnightConfig();

  const connectedAPI = midnightWallet.getConnectedAPI();
  if (!connectedAPI) {
    throw new Error(
      "[playerVoteContract] Midnight wallet not connected. Call midnightWallet.connect() first.",
    );
  }

  // Get player's shielded keys from Lace (used for getCoinPublicKey / getEncryptionPublicKey)
  const addresses = await connectedAPI.getShieldedAddresses();

  /**
   * Hook-primary WalletProvider + MidnightProvider.
   *
   * When BatcherClient.callDelegated() sets __delegatedBalanceHook,
   * balanceTx forwards the unproven tx to the hook immediately (hook-primary).
   * This ensures the batcher always handles proof generation and fee payment,
   * even if the player has midnight tokens.
   *
   * Without a hook (e.g. non-batcher calls), balanceTx falls back to wallet
   * balancing via connectedAPI.balanceUnsealedTransaction.
   */
  const provider: any = {
    getCoinPublicKey() {
      return addresses.shieldedCoinPublicKey;
    },
    getEncryptionPublicKey() {
      return addresses.shieldedEncryptionPublicKey;
    },
    async balanceTx(tx: any, newCoins?: any, ttl?: Date) {
      // Hook is set → always use batcher (primary path for player votes)
      if (typeof provider.__delegatedBalanceHook === "function") {
        await provider.__delegatedBalanceHook(tx, newCoins, ttl);
        throw new Error(DELEGATED_SENTINEL);
      }
      // Fallback: wallet balancing (no hook set)
      const serializedTx = toHex(tx.serialize());
      const received = await connectedAPI.balanceUnsealedTransaction(
        serializedTx,
        { payFees: false } as any,
      );
      return received;
    },
    submitTx: async (tx: any) => {
      await connectedAPI.submitTransaction(toHex(tx.serialize()));
    },
    __delegatedBalanceHook: undefined as any,
  };

  const zkConfigProvider = getZkConfigProvider();

  const initialPrivateState = buildVotePrivateState(
    bundle,
    gameId,
    targetIndex,
  );

  const providers = {
    privateStateProvider: getPrivateStateProvider(),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServerUrl, zkConfigProvider),
    publicDataProvider: getPublicDataProvider(config),
    walletProvider: provider,
    midnightProvider: provider,
  };

  const compiledContract = getCompiledContract();

  // Join and call circuit with retry for indexer lag.
  // "expected a cell, received null" means games.lookup(gameId) returned null —
  // the createGame tx hasn't been indexed yet. Retry with fresh ledger state.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 4000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(
        `[playerVoteContract] Game not yet in ledger (indexer lag), retrying in ${
          RETRY_DELAY_MS / 1000
        }s... (${attempt}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }

    // Use a fresh privateStateId each attempt so initialPrivateState is always used.
    const attemptStateId = `player-vote-${gameId}-${round}-${phase}-${Date.now()}`;
    try {
      const contract = await findDeployedContract(providers, {
        contractAddress: config.contractAddress,
        compiledContract,
        privateStateId: attemptStateId,
        initialPrivateState,
      });

      console.log(
        `[playerVoteContract] Joined contract (attempt ${attempt + 1}). Calling ${
          phase === "NIGHT" ? "nightAction" : "voteDay"
        } for game=${gameId}...`,
      );

      const batcherClient = new BatcherClient(contract, provider, BATCHER_URL);

      if (phase === "NIGHT" || phase === "night") {
        await batcherClient.nightAction(BigInt(gameId));
      } else {
        await batcherClient.voteDay(BigInt(gameId));
      }

      console.log(
        `[playerVoteContract] Vote submitted on-chain for game=${gameId} round=${round} phase=${phase}`,
      );
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isGameNotFound = msg.includes("expected a cell, received null");
      if (!isGameNotFound || attempt >= MAX_RETRIES) throw error;
    }
  }
}
