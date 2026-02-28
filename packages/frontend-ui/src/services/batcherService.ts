const BATCHER_URL =
  (import.meta.env.VITE_BATCHER_URL as string | undefined) ??
  'http://localhost:3334/send-input'

const EVM_ADDRESS_TYPE = 0 // AddressType.EVM

export interface BatcherInput {
  address: string
  addressType: number
  input: string
  signature: `0x${string}`
  timestamp: string
  target?: string
}

export interface BatcherRequestBody {
  data: BatcherInput
  confirmationLevel?: string
}

/**
 * Constructs the message that the wallet signs when submitting to the batcher.
 * Mirrors createMessageForBatcher from @paimaexample/concise (jsr-only package).
 */
function createMessageForBatcher(
  namespace: string | null,
  timestamp: string,
  address: string,
  inputData: string,
  target?: string,
): string {
  return ((namespace ?? '') + (target ?? '') + timestamp + address + inputData)
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLocaleLowerCase()
}

export class BatcherService {
  private static readonly DEFAULT_TARGET = 'paimaL2'

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
    const timestamp = Date.now().toString()
    const inputString = JSON.stringify(inputArray)

    // NOTE: target is not serialized into the on-chain batch by the batcher library,
    // so the L2 primitive always re-verifies with target=undefined. Sign without it.
    const message = createMessageForBatcher(null, timestamp, address, inputString)
    console.log('[BatcherService] message to sign:', message)

    const signature = await signMessage({ message })
    console.log('[BatcherService] signature:', signature)

    const batcherInput: BatcherInput = {
      address,
      addressType: EVM_ADDRESS_TYPE,
      input: inputString,
      signature,
      timestamp,
      target,
    }

    const requestBody: BatcherRequestBody = {
      data: batcherInput,
      confirmationLevel: 'wait-effectstream-processed',
    }

    console.log('[BatcherService] sending to batcher:', { url: BATCHER_URL, target, inputString })

    const response = await fetch(BATCHER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    console.log('[BatcherService] batcher HTTP status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[BatcherService] batcher error response:', errorText)
      throw new Error(
        `Batcher request failed: ${response.status} ${response.statusText}\n${errorText}`,
      )
    }

    const result = await response.json()
    console.log('[BatcherService] batcher response:', result)
    return result
  }

  static async joinGame(
    address: string,
    gameId: number,
    midnightAddressHash: `0x${string}`,
    nickname: string,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    console.log('[BatcherService] joinGame', { gameId, midnightAddressHash, nickname })
    return this.sendToBatcher(address, ['join_game', gameId, midnightAddressHash, nickname], signMessage)
  }
}
