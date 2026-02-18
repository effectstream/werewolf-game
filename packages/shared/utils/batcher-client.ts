import { fromHex, toHex } from "@midnight-ntwrk/compact-runtime";
import type { WalletProvider } from "@midnight-ntwrk/midnight-js-types";

// Default batcher URL. In browser environments, this should be overridden via the constructor if different.
const DEFAULT_BATCHER_URL = "http://localhost:3334";

/** Sentinel message thrown by balanceTx when the delegation hook intercepts the transaction. */
export const DELEGATED_SENTINEL = "Delegated balancing flow handed off to batcher";

type DelegatedTxStage = "unproven" | "unbound" | "finalized";

/**
 * BatcherClient provides a wrapper for the moderator to invoke administrative
 * actions on the Werewolf contract via a delegated batcher.
 *
 * Instead of creating its own wallet and contract join (which causes WASM
 * StateValue dual-instantiation issues in browser/Vite environments), it
 * leverages the __delegatedBalanceHook mechanism already built into the
 * createWalletAndMidnightProvider provider from contract.ts.
 *
 * The Midnight Compact Runtime evaluates the circuit and builds the unproven
 * transaction locally. In the current delegated branch
 * (`createWalletAndMidnightProvider.balanceTx` when `__delegatedBalanceHook`
 * is present), we intercept this transaction and send it directly to the
 * batcher. That means administrative delegated actions bypass Lace wallet
 * balancing/submission and rely on the batcher to finish the flow.
 */
export class BatcherClient {
  private readonly batcherUrl: string;

  /**
   * @param contract - The Lace-joined Werewolf contract instance (with callTx methods)
   * @param provider - The wallet+midnight provider object returned by createWalletAndMidnightProvider.
   *                   This must be the SAME object reference used by the contract's providers,
   *                   as we set __delegatedBalanceHook on it to intercept balanceTx.
   * @param batcherUrl - URL of the batcher's /send-input endpoint (default: http://localhost:3334)
   */
  constructor(
    private readonly contract: any,
    private readonly provider: WalletProvider & { __delegatedBalanceHook?: Function },
    batcherUrl?: string,
  ) {
    this.batcherUrl = batcherUrl ?? DEFAULT_BATCHER_URL;
  }

  /**
   * Returns true if the error originated from our delegation hook sentinel.
   */
  private isDelegationError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // Check the full error chain — the SDK may wrap the sentinel in another error
    let current: Error | undefined = error;
    while (current) {
      if (current.message.includes(DELEGATED_SENTINEL)) return true;
      current = current.cause instanceof Error ? current.cause : undefined;
    }
    return false;
  }

  /**
   * Detect serialized ledger stage to avoid txStage mismatch errors in the batcher.
   */
  private detectTxStage(serializedTx: string): DelegatedTxStage {
    // Transaction headers are ASCII:
    // midnight:transaction[v9](signature[v1],<proof-marker>,<binding-marker>):
    // We parse only the prefix to map to the batcher's expected txStage.
    const prefixHex = serializedTx.slice(0, 600).padEnd(600, "0");
    const prefixBytes = fromHex(prefixHex);
    const header = new TextDecoder().decode(prefixBytes);

    const markerMatch = header.match(
      /midnight:transaction\[v\d+\]\(signature\[v\d+\],([^,]+),([^)]+)\):/,
    );

    if (!markerMatch) {
      throw new Error(
        `[BatcherClient] Could not parse transaction header markers from: ${
          header.slice(0, 120)
        }`,
      );
    }

    const proofMarker = markerMatch[1];
    const bindingMarker = markerMatch[2];

    if (proofMarker.includes("proof-preimage")) return "unproven";
    if (bindingMarker.includes("embedded-fr")) return "unbound";
    if (bindingMarker.includes("pedersen-schnorr")) return "finalized";

    throw new Error(
      `[BatcherClient] Unknown tx markers proof=${proofMarker} binding=${bindingMarker}`,
    );
  }

  /**
   * Helper to intercept and send to batcher via the delegation hook.
   */
  private async callDelegated(
    circuitName: string,
    callFn: () => Promise<any>,
  ): Promise<void> {
    console.log(
      `🔍 [BatcherClient] Preparing delegated call for ${circuitName}...`,
    );

    // Define the async hook directly
    this.provider.__delegatedBalanceHook = async (
      tx: any,
      _newCoins?: any,
      _ttl?: Date,
    ) => {
      let serializedTx = toHex(tx.serialize());

      // Attempt to bind the transaction if the method exists
      if (typeof tx.bind === "function") {
        try {
          serializedTx = toHex(tx.bind().serialize());
        } catch (e) {
          console.warn(`[BatcherClient] Failed to bind ${circuitName} tx`, e);
        }
      }

      const txStage = this.detectTxStage(serializedTx);

      // Post to batcher immediately
      await this.postToBatcher(serializedTx, circuitName, txStage);

      // Throw sentinel to safely abort the rest of the Midnight SDK pipeline
      throw new Error(DELEGATED_SENTINEL);
    };

    try {
      await callFn();
    } catch (error) {
      // If we see our sentinel, the hook succeeded. Ignore it.
      if (this.isDelegationError(error)) return;

      // If we see a genuine error (e.g., batcher network failure, circuit eval failed), re-throw it.
      console.error(
        `❌ [BatcherClient] ${circuitName} unexpected error:`,
        error,
      );
      throw error;
    } finally {
      // Always clear the hook so normal Lace operations still work
      delete this.provider.__delegatedBalanceHook;
    }
  }

  private async postToBatcher(
    serializedTx: string,
    circuitId: string,
    txStage: DelegatedTxStage = "finalized",
  ): Promise<void> {
    console.log(
      `🔍 [BatcherClient] Posting to Batcher at ${this.batcherUrl}/send-input...`,
    );
    const body = {
      data: {
        target: "midnight_balancing",
        address: "moderator_trusted_node", // Mock address
        addressType: 0,
        input: JSON.stringify({
          tx: serializedTx,
          txStage: txStage,
          circuitId: circuitId,
        }),
        timestamp: Date.now(),
      },
      confirmationLevel: "wait-receipt",
    };

    try {
      const response = await fetch(`${this.batcherUrl}/send-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `❌ [BatcherClient] Batcher rejected transaction (HTTP ${response.status}):`,
          text,
        );
        throw new Error(`Batcher rejected transaction: ${text}`);
      }

      const result = await response.json();
      if (!result.success) {
        console.error(`❌ [BatcherClient] Batcher failed:`, result.message);
        throw new Error(`Batcher failed: ${result.message}`);
      }

      console.log(
        `✅ [BatcherClient] ${circuitId} submitted successfully via batcher!`,
      );
    } catch (e) {
      console.error(`❌ [BatcherClient] Network error calling batcher:`, e);
      throw e;
    }
  }

  // --- Administrative Actions ---
  // These use the Lace-joined contract directly. The private state
  // (with setup data) is already populated by App.tsx via stageSetupData().
  // The default witnesses from witnesses.ts handle reading from it.

  async createGame(
    gameId: bigint,
    adminVotePublicKey: Uint8Array,
    masterSecretCommitment: Uint8Array,
    actualCount: bigint,
    werewolfCount: bigint,
  ): Promise<void> {
    await this.callDelegated(
      "createGame",
      async () =>
        await this.contract.callTx.createGame(
          gameId,
          adminVotePublicKey,
          masterSecretCommitment,
          actualCount,
          werewolfCount,
        ),
    );
  }

  async resolveNight(
    gameId: bigint,
    newRound: bigint,
    deadPlayerIdx: bigint,
    hasDeath: boolean,
    newMerkleRoot: { field: bigint },
  ): Promise<void> {
    await this.callDelegated(
      "resolveNightPhase",
      () =>
        this.contract.callTx.resolveNightPhase(
          gameId,
          newRound,
          deadPlayerIdx,
          hasDeath,
          newMerkleRoot,
        ),
    );
  }

  async resolveDay(
    gameId: bigint,
    eliminatedIdx: bigint,
    hasElimination: boolean,
  ): Promise<void> {
    await this.callDelegated(
      "resolveDayPhase",
      () =>
        this.contract.callTx.resolveDayPhase(
          gameId,
          eliminatedIdx,
          hasElimination,
        ),
    );
  }

  async forceEndGame(
    gameId: bigint,
    masterSecret: Uint8Array,
  ): Promise<void> {
    await this.callDelegated(
      "forceEndGame",
      () => this.contract.callTx.forceEndGame(gameId, masterSecret),
    );
  }
}
