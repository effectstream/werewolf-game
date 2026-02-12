import {
  type FinalizedTransaction,
  Transaction as LedgerTransaction,
} from "@midnight-ntwrk/ledger-v7";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-utils";
import type {
  MidnightProvider,
  MidnightProviders,
  UnboundTransaction,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { AddressType } from "@paimaexample/utils";

const BATCHER_URL = Deno.env.get("BATCHER_URL") ?? "http://localhost:3334";

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

  constructor(
    private readonly contract: any, // The joined Werewolf contract instance
    private readonly batcherUrl: string = BATCHER_URL,
  ) {}

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
        addressType: AddressType.MIDNIGHT,
        input: JSON.stringify({
          tx: serializedTx,
          txStage: "finalized",
          circuitId: circuitId,
        }),
        timestamp: Date.now(),
      },
      confirmationLevel: "wait-receipt", //"wait-effectstream-processed",
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
    walletResult: any,
  ): WalletProvider & MidnightProvider {
    const self = this;
    return {
      getCoinPublicKey() {
        return walletResult.zswapSecretKeys.coinPublicKey;
      },
      getEncryptionPublicKey() {
        return walletResult.zswapSecretKeys.encryptionPublicKey;
      },
      balanceTx(
        tx: UnboundTransaction,
        _ttl?: Date,
      ): Promise<FinalizedTransaction> {
        const bound = tx.bind();
        self.lastSerializedTx = toHex(bound.serialize());

        // Validate round-trip, if not correct, this will throw an error
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
    };
  }

  // --- Administrative Actions ---

  async createGame(
    gameId: number,
    adminVotePublicKey: Uint8Array,
    masterSecretCommitment: Uint8Array,
    actualCount: number,
    werewolfCount: number,
  ): Promise<void> {
    await this.callDelegated(
      "createAndSetupGame",
      () =>
        this.contract.callTx.createAndSetupGame(
          gameId,
          adminVotePublicKey,
          masterSecretCommitment,
          actualCount,
          werewolfCount,
        ),
    );
  }

  async resolveNightPhase(
    gameId: number,
    newRound: number,
    deadPlayerIdx: number,
    hasDeath: boolean,
    newMerkleRoot: any, // MerkleTreeDigest
  ): Promise<void> {
    await this.callDelegated(
      "resolveNight",
      () =>
        this.contract.callTx.resolveNight(
          gameId,
          newRound,
          deadPlayerIdx,
          hasDeath,
          newMerkleRoot,
        ),
    );
  }

  async resolveDayPhase(
    gameId: number,
    eliminatedIdx: number,
    hasElimination: boolean,
  ): Promise<void> {
    await this.callDelegated(
      "resolveDay",
      () =>
        this.contract.callTx.resolveDay(
          gameId,
          eliminatedIdx,
          hasElimination,
        ),
    );
  }

  async forceEndGame(
    gameId: number,
    masterSecret: Uint8Array,
  ): Promise<void> {
    await this.callDelegated(
      "endGame",
      () => this.contract.callTx.endGame(gameId, masterSecret),
    );
  }

  async adminPunishPlayer(
    gameId: number,
    playerIdx: number,
  ): Promise<void> {
    await this.callDelegated(
      "punishPlayer",
      () => this.contract.callTx.punishPlayer(gameId, playerIdx),
    );
  }
}
