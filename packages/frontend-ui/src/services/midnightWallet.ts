/**
 * Minimal type declarations for the Midnight dApp Connector API injected by
 * the Lace browser extension into `window.midnight`.
 *
 * These mirror the shape of @midnight-ntwrk/dapp-connector-api without
 * requiring a runtime dependency in the frontend-ui package.
 */
interface MidnightShieldedAddresses {
  shieldedAddress: string
  coinPublicKey: string
  encryptionPublicKey: string
}

interface MidnightConnectedAPI {
  getShieldedAddresses(): Promise<MidnightShieldedAddresses>
}

interface MidnightConnectorAPI {
  apiVersion: string
  connect(networkId: string): Promise<MidnightConnectedAPI>
}

// Extend Window to include the midnight object injected by the Lace extension
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    midnight?: Record<string, MidnightConnectorAPI>
  }
}

export interface MidnightWalletState {
  isConnected: boolean
  shieldedAddress: string | null
}

class MidnightWalletManager {
  private _shieldedAddress: string | null = null
  private _connectedAPI: MidnightConnectedAPI | null = null

  /** Returns true if the Lace extension has injected window.midnight. */
  isAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!window.midnight &&
      Object.keys(window.midnight).length > 0
    )
  }

  /**
   * Connects to the first compatible Midnight wallet found on window.midnight
   * and retrieves the player's shielded address.
   *
   * @param networkId - Network ID passed to the connector (e.g. 'undeployed', 'testnet').
   */
  async connect(networkId = 'undeployed'): Promise<MidnightWalletState> {
    const midnight = window.midnight
    if (!midnight) {
      throw new Error(
        'Midnight wallet not found. Please install the Lace wallet extension.',
      )
    }

    // Find the first entry that exposes apiVersion (compatible connector)
    const entry = Object.entries(midnight).find(([_, api]) => !!api.apiVersion)
    if (!entry) {
      throw new Error('No compatible Midnight wallet found.')
    }

    const [name, api] = entry
    console.log(`[MidnightWallet] Connecting to: ${name} (v${api.apiVersion})`)

    this._connectedAPI = await api.connect(networkId)
    const addresses = await this._connectedAPI.getShieldedAddresses()
    this._shieldedAddress = addresses.shieldedAddress

    console.log('[MidnightWallet] Connected. Shielded address:', this._shieldedAddress)
    return { isConnected: true, shieldedAddress: this._shieldedAddress }
  }

  getShieldedAddress(): string | null {
    return this._shieldedAddress
  }

  getState(): MidnightWalletState {
    return {
      isConnected: this._shieldedAddress !== null,
      shieldedAddress: this._shieldedAddress,
    }
  }
}

export const midnightWallet = new MidnightWalletManager()
