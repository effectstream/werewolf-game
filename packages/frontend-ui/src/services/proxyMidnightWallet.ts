/**
 * Proxy Midnight Wallet — seed-derived fallback for players without Lace.
 *
 * Derives a deterministic Midnight identity from the EVM wallet: signs a
 * fixed message, SHA-256 hashes the signature, and uses the 32-byte result
 * as a ZswapSecretKeys seed. Exposes the same interfaces as the Lace
 * ConnectedAPI so downstream code (playerVoteContract, midnightWallet) works
 * without modification.
 *
 * Voting still routes through the batcher via the __delegatedBalanceHook
 * mechanism — no on-chain signing is done locally.
 */

import { ZswapSecretKeys } from "@midnight-ntwrk/ledger-v8";
import { DELEGATED_SENTINEL } from "../../../shared/utils/batcher-client.ts";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { WalletClient } from "viem";

// Message signed by the EVM wallet to deterministically derive the Midnight seed.
// Changing this value would invalidate all existing proxy wallets.
const PROXY_SEED_MESSAGE = "werewolf:midnight-seed" as const;

// API_BASE for submitting transactions via the Midnight node.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:9999";

export interface ProxyWalletState {
  isProxy: true;
  /** The coin public key used as the shielded address for leaderboard purposes. */
  shieldedAddress: string;
  /** The coin public key (same as shieldedAddress for proxy wallets). */
  coinPublicKey: string;
  /** The encryption public key. */
  encryptionPublicKey: string;
}

class ProxyMidnightWalletManager {
  private _secretKeys: ZswapSecretKeys | null = null;
  private _shieldedAddress: string | null = null;
  private _nodeUrl: string | null = null;

  /**
   * Derives the Midnight seed from the EVM wallet and initialises keys.
   * Safe to call multiple times — subsequent calls return the cached state.
   */
  async initialize(
    walletClient: WalletClient,
    evmAddress: `0x${string}`,
  ): Promise<ProxyWalletState> {
    if (this._secretKeys && this._shieldedAddress) {
      return {
        isProxy: true,
        shieldedAddress: this._shieldedAddress,
        coinPublicKey: this._secretKeys.coinPublicKey,
        encryptionPublicKey: this._secretKeys.encryptionPublicKey,
      };
    }

    const seed = await this._deriveSeed(walletClient);
    this._secretKeys = ZswapSecretKeys.fromSeed(seed);
    // Use the coin public key as the shielded address identifier.
    // It is unique, deterministic, and works as a leaderboard key.
    this._shieldedAddress = this._secretKeys.coinPublicKey;

    console.log(
      "[ProxyWallet] Initialized. Proxy shielded address:",
      this._shieldedAddress.slice(0, 16) + "…",
    );

    return {
      isProxy: true,
      shieldedAddress: this._shieldedAddress,
      coinPublicKey: this._secretKeys.coinPublicKey,
      encryptionPublicKey: this._secretKeys.encryptionPublicKey,
    };
  }

  /** Sets the Midnight node URL for transaction submission (from /api/midnight_config). */
  setNodeUrl(nodeUrl: string): void {
    this._nodeUrl = nodeUrl;
  }

  getShieldedAddress(): string | null {
    return this._shieldedAddress;
  }

  /**
   * Returns a ConnectedAPI-compatible object for use in playerVoteContract.ts.
   * The batcher hook intercepts before balanceUnsealedTransaction is ever called,
   * so that method is a no-op placeholder.
   */
  asConnectedAPI(): ConnectedAPI {
    if (!this._secretKeys || !this._shieldedAddress) {
      throw new Error("[ProxyWallet] Not initialized. Call initialize() first.");
    }

    const coinPublicKey = this._secretKeys.coinPublicKey;
    const encryptionPublicKey = this._secretKeys.encryptionPublicKey;
    const shieldedAddress = this._shieldedAddress;
    const getNodeUrl = () => this._nodeUrl;

    return {
      getShieldedAddresses: async () => ({
        shieldedAddress,
        shieldedCoinPublicKey: coinPublicKey,
        shieldedEncryptionPublicKey: encryptionPublicKey,
      }),
      // The batcher hook intercepts balanceTx before this is ever called.
      // Provided as a fallback only — proxy wallets cannot self-balance.
      balanceUnsealedTransaction: async (_serializedTx: string, _opts: unknown) => {
        throw new Error(
          "[ProxyWallet] balanceUnsealedTransaction is not supported for proxy wallets. " +
            "The batcher hook should intercept before this is called.",
        );
      },
      submitTransaction: async (serializedTx: string) => {
        const nodeUrl = getNodeUrl();
        if (!nodeUrl) {
          throw new Error(
            "[ProxyWallet] Midnight node URL not set. Call setNodeUrl() after fetching midnight_config.",
          );
        }
        const response = await fetch(`${nodeUrl}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: serializedTx }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `[ProxyWallet] Transaction submission failed: ${response.status} ${body}`,
          );
        }
      },
      // Unused but required by the ConnectedAPI interface:
      getUnshieldedAddress: async () => ({ unshieldedAddress: "" }),
      getDustAddress: async () => ({ dustAddress: "" }),
    } as unknown as ConnectedAPI;
  }

  /**
   * Returns a WalletProvider object for BatcherClient — identical shape to
   * the provider in playerVoteContract.ts. The __delegatedBalanceHook is set
   * by BatcherClient.callDelegated() at call time.
   */
  asWalletProvider(): Record<string, unknown> {
    if (!this._secretKeys) {
      throw new Error("[ProxyWallet] Not initialized. Call initialize() first.");
    }

    const coinPublicKey = this._secretKeys.coinPublicKey;
    const encryptionPublicKey = this._secretKeys.encryptionPublicKey;

    const provider: Record<string, unknown> = {
      getCoinPublicKey() {
        return coinPublicKey;
      },
      getEncryptionPublicKey() {
        return encryptionPublicKey;
      },
      async balanceTx(tx: unknown, newCoins?: unknown, ttl?: Date) {
        if (typeof (provider.__delegatedBalanceHook as Function | undefined) === "function") {
          await (provider.__delegatedBalanceHook as Function)(tx, newCoins, ttl);
          throw new Error(DELEGATED_SENTINEL);
        }
        throw new Error(
          "[ProxyWallet] balanceTx called without a batcher hook. " +
            "Proxy wallets require the batcher for fee balancing.",
        );
      },
      submitTx: async (_tx: unknown) => {
        // submitTx is reached after the batcher returns a finalized tx.
        // The batcher handles on-chain submission, so this is a no-op.
      },
      __delegatedBalanceHook: undefined as unknown,
    };

    return provider;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _deriveSeed(
    walletClient: WalletClient,
  ): Promise<Uint8Array> {
    // Sign a fixed message to produce a deterministic 65-byte ECDSA signature.
    // Same pattern as deriveGameKeypair in LobbyScreen.ts.
    const sig = await walletClient.signMessage({
      message: PROXY_SEED_MESSAGE,
    });

    // Strip 0x prefix and convert to bytes (65 bytes)
    const sigHex = sig.startsWith("0x") ? sig.slice(2) : sig;
    const sigBytes = new Uint8Array(sigHex.length / 2);
    for (let i = 0; i < sigBytes.length; i++) {
      sigBytes[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
    }

    // SHA-256 hash → 32-byte seed
    const hashBuffer = await crypto.subtle.digest("SHA-256", sigBytes);
    return new Uint8Array(hashBuffer);
  }
}

export const proxyMidnightWallet = new ProxyMidnightWalletManager();
