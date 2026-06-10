const BATCHER_BASE =
  (import.meta.env.VITE_BATCHER_URL as string | undefined) ??
  'http://localhost:3334'

const BATCHER_URL = `${BATCHER_BASE}/send-input`

const EVM_ADDRESS_TYPE = 0 // AddressType.EVM

// Security-namespace prefix the node's L2 primitive verifies batched signatures
// against (getReadNamespaces). MUST match setSecurityNamespace(...) in
// packages/shared/data-types/src/config*.ts — all envs use "evm-midnight-node".
const SECURITY_NAMESPACE = 'evm-midnight-node'

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
 * Mirrors createMessageForBatcher from @effectstream/concise (jsr-only package).
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

    // The node's L2 primitive verifies (namespace + target + ts + addr + input).
    // `target` is NOT serialized into the on-chain batch, so it re-verifies with
    // target=undefined → omit it here. But the namespace IS required: sign with it.
    const message = createMessageForBatcher(SECURITY_NAMESPACE, timestamp, address, inputString)
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
      // werewolf runs MQTT_BROKER=false, so wait-effectstream-processed can never
      // get its SyncChains notification (60s timeout). wait-receipt resolves on
      // tx-mined; the frontend then polls node state (pollForBundles) for the result.
      confirmationLevel: 'wait-receipt',
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
    publicKey: string,
    nickname: string,
    appearanceCode: number,
    midnightAddress: string,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    console.log('[BatcherService] joinGame', {
      gameId,
      publicKey,
      nickname,
      appearanceCode,
      midnightAddress,
    })
    return this.sendToBatcher(
      address,
      ['join_game', gameId, publicKey, nickname, appearanceCode, midnightAddress],
      signMessage,
    )
  }

  static async forceStart(
    address: string,
    gameId: number,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    console.log('[BatcherService] forceStart', { gameId })
    return this.sendToBatcher(address, ['force_start', gameId], signMessage)
  }

  /**
   * Records the (evmAddress → proxyMidnightAddress) mapping on-chain.
   * Idempotent — replaying this for the same EVM address is a no-op.
   */
  static async registerProxyWallet(
    address: string,
    proxyMidnightAddress: string,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    console.log('[BatcherService] registerProxyWallet', { proxyMidnightAddress: proxyMidnightAddress.slice(0, 16) + '…' })
    return this.sendToBatcher(address, ['register_proxy_wallet', proxyMidnightAddress], signMessage)
  }

  /**
   * Claims a real Lace midnight address for an existing proxy wallet.
   * Triggers leaderboard point migration from proxyMidnightAddress → realMidnightAddress.
   * Only the EVM address that registered the proxy can submit this.
   */
  static async claimRealWallet(
    address: string,
    proxyMidnightAddress: string,
    realMidnightAddress: string,
    signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  ): Promise<unknown> {
    console.log('[BatcherService] claimRealWallet', {
      proxyMidnightAddress: proxyMidnightAddress.slice(0, 16) + '…',
      realMidnightAddress: realMidnightAddress.slice(0, 16) + '…',
    })
    return this.sendToBatcher(
      address,
      ['claim_real_wallet', proxyMidnightAddress, realMidnightAddress],
      signMessage,
    )
  }
}
