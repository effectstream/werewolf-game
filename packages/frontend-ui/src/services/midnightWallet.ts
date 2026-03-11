import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api'

/**
 * Extends the Window object to include the Midnight DApp Connector API
 * injected by the Lace browser extension.
 */
declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>
  }
}

export interface MidnightWalletState {
  isConnected: boolean
  shieldedAddress: string | null
}

class MidnightWalletManager {
  private _shieldedAddress: string | null = null
  private _connectedAPI: ConnectedAPI | null = null

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

  /** Returns the full DApp Connector API for building and signing Midnight transactions. */
  getConnectedAPI(): ConnectedAPI | null {
    return this._connectedAPI
  }

  getState(): MidnightWalletState {
    return {
      isConnected: this._shieldedAddress !== null,
      shieldedAddress: this._shieldedAddress,
    }
  }
}

export const midnightWallet = new MidnightWalletManager()
