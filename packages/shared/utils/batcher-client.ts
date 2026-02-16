// Default batcher URL. In browser environments, this should be overridden via the constructor if different.
const DEFAULT_BATCHER_URL = "http://localhost:3334";

/** Sentinel message thrown by balanceTx when the delegation hook intercepts the transaction. */
const DELEGATED_SENTINEL = "Delegated balancing flow handed off to batcher";
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
 * The Lace wallet is used to build the circuit arguments and run the
 * circuit locally (proving the transaction). The balanceTx interception
 * captures the unproven serialized transaction and sends it to the
 * batcher for balancing and submission.
 *
 * Lace's bug with sending contract transactions is bypassed because
 * the hook intercepts BEFORE Lace's balanceUnsealedTransaction is called.
 */
export class BatcherClient {
  private readonly batcherUrl: string;
  private capturedSerializedTx: string | null = null;

  /**
   * @param contract - The Lace-joined Werewolf contract instance (with callTx methods)
   * @param provider - The wallet+midnight provider object returned by createWalletAndMidnightProvider.
   *                   This must be the SAME object reference used by the contract's providers,
   *                   as we set __delegatedBalanceHook on it to intercept balanceTx.
   * @param batcherUrl - URL of the batcher's /send-input endpoint (default: http://localhost:3334)
   */
  constructor(
    private readonly contract: any,
    private readonly provider: any,
    batcherUrl?: string,
  ) {
    this.batcherUrl = batcherUrl ?? DEFAULT_BATCHER_URL;
  }

  /**
   * Sets the delegation hook on the provider. When balanceTx is called,
   * the hook captures the serialized transaction and throws so Lace
   * is never invoked.
   */
  private setDelegationHook(): void {
    this.capturedSerializedTx = null;
    this.provider.__delegatedBalanceHook = (serializedTx: string) => {
      console.log(
        "🔍 [BatcherClient] Captured serialized transaction via delegation hook",
      );
      this.capturedSerializedTx = serializedTx;
    };
  }

  /**
   * Clears the delegation hook so that subsequent non-batcher operations
   * (player actions, etc.) go through the normal Lace flow.
   */
  private clearDelegationHook(): void {
    delete this.provider.__delegatedBalanceHook;
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
   * If a serialized tx was captured by the hook, send it to the batcher.
   * Returns true if it was sent, false otherwise.
   */
  private async trySendCaptured(circuitName: string): Promise<boolean> {
    const captured = this.capturedSerializedTx;
    if (!captured) return false;
    const txStage = this.detectTxStage(captured);
    console.log(`🚀 [BatcherClient] Sending ${circuitName} to Batcher...`);
    console.log(`🧾 [BatcherClient] Detected tx stage: ${txStage}`);
    await this.postToBatcher(captured, circuitName, txStage);
    return true;
  }

  /**
   * Detect serialized ledger stage to avoid txStage mismatch errors in the batcher.
   */
  private detectTxStage(serializedTx: string): DelegatedTxStage {
    // Transaction headers are ASCII:
    // midnight:transaction[v9](signature[v1],<proof-marker>,<binding-marker>):
    // We parse only the prefix to map to the batcher's expected txStage.
    const prefixBytes = new Uint8Array(
      serializedTx
        .slice(0, 600)
        .match(/.{1,2}/g)
        ?.map((pair) => parseInt(pair, 16)) ?? [],
    );
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

    this.setDelegationHook();

    try {
      await callFn();
      // The SDK may swallow the balanceTx error. If the hook captured the tx,
      // send it even though callFn resolved without throwing.
      if (await this.trySendCaptured(circuitName)) {
        return;
      }
      // Hook was never triggered — something is wrong.
      throw new Error(
        `Circuit ${circuitName} completed but delegation hook was never triggered`,
      );
    } catch (error) {
      // If the hook captured the tx (regardless of error type), send it.
      if (await this.trySendCaptured(circuitName)) {
        return;
      }

      // The hook didn't capture anything. Only tolerate our sentinel error
      // (which means the hook ran but somehow the tx wasn't stored — shouldn't happen).
      if (this.isDelegationError(error)) {
        throw new Error(
          `[BatcherClient] Delegation hook fired for ${circuitName} but no transaction was captured`,
        );
      }

      // Genuine unexpected error — re-throw as-is.
      console.error(
        `❌ [BatcherClient] ${circuitName} unexpected error:`,
        error,
      );
      throw error;
    } finally {
      // Always clear the hook so normal Lace operations still work
      this.clearDelegationHook();
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
    gameId: number | bigint,
    adminVotePublicKey: Uint8Array,
    masterSecretCommitment: Uint8Array,
    actualCount: number | bigint,
    werewolfCount: number | bigint,
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
    gameId: number | bigint,
    newRound: number | bigint,
    deadPlayerIdx: number | bigint,
    hasDeath: boolean,
    newMerkleRoot: any,
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
    gameId: number | bigint,
    eliminatedIdx: number | bigint,
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
    gameId: number | bigint,
    masterSecret: Uint8Array,
  ): Promise<void> {
    await this.callDelegated(
      "forceEndGame",
      () => this.contract.callTx.forceEndGame(gameId, masterSecret),
    );
  }
}
