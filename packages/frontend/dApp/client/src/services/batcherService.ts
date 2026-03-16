import { createMessageForBatcher } from "@paimaexample/concise";
import { AddressType } from "@paimaexample/utils";

const BATCHER_PORT = "3334";
const BATCHER_URL = `http://localhost:${BATCHER_PORT}/send-input`;

export interface BatcherInput {
  address: string;
  addressType: AddressType;
  input: string;
  signature: `0x${string}`;
  timestamp: string;
  target?: string;
}

export interface BatcherRequestBody {
  data: BatcherInput;
  confirmationLevel?: string;
}

export class BatcherService {
  private static readonly DEFAULT_TARGET = "paimaL2";

  /**
   * Send a grammar-format array input to the batcher.
   * inputArray must be ["grammar_key", ...args] — the exact format the Paima STM expects.
   */
  static async sendToBatcher(
    address: string,
    inputArray: unknown[],
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
    target: string = BatcherService.DEFAULT_TARGET,
  ): Promise<unknown> {
    const timestamp = Date.now().toString();
    const inputString = JSON.stringify(inputArray);

    // NOTE: target is not serialized into the on-chain batch by the batcher library,
    // so the L2 primitive always re-verifies with target=undefined. Sign without it.
    const message = createMessageForBatcher(
      null, // namespace
      timestamp,
      address,
      AddressType.EVM,
      inputString,
      // target intentionally omitted
    );

    const signature = await signMessage({ message });

    const batcherInput: BatcherInput = {
      address,
      addressType: AddressType.EVM,
      input: inputString,
      signature,
      timestamp,
      target,
    };

    const requestBody: BatcherRequestBody = {
      data: batcherInput,
      confirmationLevel: "wait-effectstream-processed",
    };

    console.log("Sending to batcher:", { url: BATCHER_URL, target, inputString });

    const response = await fetch(BATCHER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Batcher request failed: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    const result = await response.json();
    console.log("Batcher response:", result);
    return result;
  }

  static async createGame(
    address: string,
    gameId: bigint,
    maxPlayers: number,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    return this.sendToBatcher(
      address,
      ["create_game", Number(gameId), maxPlayers],
      signMessage,
    );
  }

  static async joinGame(
    address: string,
    gameId: bigint,
    midnightAddressHash: string,
    nickname: string,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    return this.sendToBatcher(
      address,
      ["join_game", Number(gameId), midnightAddressHash, nickname],
      signMessage,
    );
  }
}
