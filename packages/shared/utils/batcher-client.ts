import {
  type FinalizedTransaction,
  Transaction as LedgerTransaction,
} from "@midnight-ntwrk/ledger-v7";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-utils";
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";

// Default batcher URL. In browser environments, this should be overridden via the constructor if different.
const DEFAULT_BATCHER_URL = "http://localhost:3334";

export class DelegatedBalancingSentError extends Error {
  constructor() {
    super("Delegated balancing flow handed off to batcher");
  }
}

/**
 * BatcherClient provides a wrapper for the moderator to invoke administrative
 * actions on the Werewolf contract via a delegated batcher.
 */
export class BatcherClient {
  private lastSerializedTx: string | null = null;
  private readonly batcherUrl: string;

  constructor(
    private readonly contract: any, // The joined Werewolf contract instance
    batcherUrl?: string,
  ) {
    this.batcherUrl = batcherUrl ?? DEFAULT_BATCHER_URL;
  }

  /**
   * Helper to intercept and send to batcher.
   */
  private async callDelegated(
    circuitName: string,
    callFn: () => Promise<any>,
  ): Promise<void> {
    this.lastSerializedTx = null;
    try {
      await callFn();
    } catch (error) {
      if (error instanceof DelegatedBalancingSentError) {
        if (!this.lastSerializedTx) {
          throw new Error(`Failed to capture transaction for ${circuitName}`);
        }

        console.log(`🚀 Sending ${circuitName} to Batcher...`);
        await this.postToBatcher(this.lastSerializedTx, circuitName);
        return;
      }
      throw error;
    }
    throw new Error(
      `Circuit ${circuitName} did not trigger delegated balancing interceptor`,
    );
  }

  private async postToBatcher(
    serializedTx: string,
    circuitId: string,
  ): Promise<void> {
    const body = {
      data: {
        target: "midnight_balancing",
        address: "moderator_trusted_node",
        addressType: "midnight", // Simplified for shared use
        input: JSON.stringify({
          tx: serializedTx,
          txStage: "finalized",
          circuitId: circuitId,
        }),
        timestamp: Date.now(),
      },
      confirmationLevel: "wait-receipt",
    };

    const response = await fetch(`${this.batcherUrl}/send-input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Batcher rejected transaction: ${text}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`Batcher failed: ${result.message}`);
    }

    console.log(`✅ ${circuitId} submitted successfully via batcher!`);
  }

  /**
   * Creates an intercepting provider that captures the transaction and throws DelegatedBalancingSentError.
   */
  public createInterceptingProvider(
    coinPublicKey: any,
    encryptionPublicKey: any,
  ): WalletProvider & MidnightProvider {
    const self = this;
    return {
      getCoinPublicKey() {
        return coinPublicKey;
      },
      getEncryptionPublicKey() {
        return encryptionPublicKey;
      },
      balanceTx(
        tx: UnboundTransaction,
        _ttl?: Date,
      ): Promise<FinalizedTransaction> {
        const bound = tx.bind();
        self.lastSerializedTx = toHex(bound.serialize());

        // Validate round-trip
        LedgerTransaction.deserialize(
          "signature" as const,
          "proof" as const,
          "binding" as const,
          fromHex(self.lastSerializedTx),
        );

        return Promise.resolve(bound);
      },
      submitTx(_tx: FinalizedTransaction): Promise<any> {
        throw new DelegatedBalancingSentError();
      },
    } as any;
  }

  // --- Administrative Actions ---

  async createAndSetupGame(
    gameId: number | bigint,
    adminKey: any,
    adminVotePublicKey: Uint8Array,
    masterSecretCommitment: Uint8Array,
    actualCount: number | bigint,
    werewolfCount: number | bigint,
    initialRoot: any,
  ): Promise<void> {
    await this.callDelegated(
      "createGame",
      () =>
        this.contract.callTx.createGame(
          gameId,
          adminKey,
          adminVotePublicKey,
          masterSecretCommitment,
          actualCount,
          werewolfCount,
          initialRoot,
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
