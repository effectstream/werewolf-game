import {
  createPublicClient,
  createWalletClient,
  custom,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { hardhat } from 'viem/chains'

export interface EvmWalletState {
  isConnected: boolean
  address: `0x${string}` | null
}

// Extend Window to include ethereum injected by MetaMask / any EIP-1193 wallet
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any
  }
}

class EvmWalletManager {
  private _address: `0x${string}` | null = null
  private _walletClient: WalletClient | null = null
  private _publicClient: PublicClient | null = null

  isAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.ethereum
  }

  async connect(): Promise<EvmWalletState> {
    if (!this.isAvailable()) {
      throw new Error('No EVM wallet detected. Please install MetaMask.')
    }

    const transport = custom(window.ethereum!)

    this._walletClient = createWalletClient({
      chain: hardhat,
      transport,
    })

    this._publicClient = createPublicClient({
      chain: hardhat,
      transport,
    })

    const addresses = await this._walletClient.requestAddresses()
    if (addresses.length === 0) {
      throw new Error('No accounts returned by wallet.')
    }

    this._address = addresses[0]
    return { isConnected: true, address: this._address }
  }

  getAddress(): `0x${string}` | null {
    return this._address
  }

  getWalletClient(): WalletClient {
    if (!this._walletClient) {
      throw new Error('EVM wallet not connected. Call connect() first.')
    }
    return this._walletClient
  }

  getPublicClient(): PublicClient {
    if (!this._publicClient) {
      throw new Error('EVM wallet not connected. Call connect() first.')
    }
    return this._publicClient
  }

  getState(): EvmWalletState {
    return { isConnected: this._address !== null, address: this._address }
  }
}

export const evmWallet = new EvmWalletManager()
