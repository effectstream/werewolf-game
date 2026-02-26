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
   * Send data to the batcher for the paimaL2 target
   * @param address - The wallet address
   * @param inputData - The data to send (will be JSON stringified)
   * @param signMessage - A function that signs the message (from viem wallet client)
   * @param target - The batcher target (default: "paimaL2")
   */
  static async sendToBatcher(
    address: string,
    inputData: any,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
    target: string = BatcherService.DEFAULT_TARGET,
  ): Promise<unknown> {
    const timestamp = Date.now().toString();
    const inputString = JSON.stringify(inputData);

    // Create the message to be signed
    const message = createMessageForBatcher(
      null, // namespace
      timestamp,
      address,
      AddressType.EVM,
      inputString,
      target, // target for the batcher
    );

    // Sign the message with the wallet
    // viem's signMessage expects { message: string | Uint8Array }
    const signature = await signMessage({ message });

    // Prepare the batcher input
    const batcherInput: BatcherInput = {
      address,
      addressType: AddressType.EVM,
      input: inputString,
      signature,
      timestamp,
      target,
    };

    // Prepare the request body
    const requestBody: BatcherRequestBody = {
      data: batcherInput,
      confirmationLevel: "wait-effectstream-processed",
    };

    console.log("Sending to batcher:", {
      url: BATCHER_URL,
      target,
      inputData,
    });

    // Send to batcher
    const response = await fetch(BATCHER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

  /**
   * Create game via batcher
   */
  static async createGame(
    address: string,
    gameId: bigint,
    maxPlayers: number,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    const inputData = {
      method: "createGame",
      args: [gameId.toString(), maxPlayers],
    };

    return this.sendToBatcher(
      address,
      inputData,
      signMessage,
      BatcherService.DEFAULT_TARGET,
    );
  }

  /**
   * Submit game input via batcher
   */
  static async submitGameInput(
    address: string,
    inputs: string[],
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    const inputData = {
      inputs,
    };

    return this.sendToBatcher(
      address,
      inputData,
      signMessage,
      BatcherService.DEFAULT_TARGET,
    );
  }
}
