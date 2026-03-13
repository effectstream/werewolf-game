import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { hardhat } from 'viem/chains'

export interface EvmWalletState {
  isConnected: boolean
  address: `0x${string}` | null
}

export const LOCAL_STORAGE_KEY = 'werewolf:evm-private-key'
const PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/

class EvmWalletManager {
  private _address: `0x${string}` | null = null
  private _walletClient: WalletClient | null = null
  private _publicClient: PublicClient | null = null

  private loadOrCreatePrivateKey(): `0x${string}` {
    if (typeof window === 'undefined') {
      throw new Error('EVM wallet requires a browser environment.')
    }

    const persisted = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (persisted && PRIVATE_KEY_REGEX.test(persisted)) {
      return persisted as `0x${string}`
    }

    const privateKey = generatePrivateKey()
    window.localStorage.setItem(LOCAL_STORAGE_KEY, privateKey)
    return privateKey
  }

  async connect(): Promise<EvmWalletState> {
    const privateKey = this.loadOrCreatePrivateKey()
    const account = privateKeyToAccount(privateKey)
    const transport = http(hardhat.rpcUrls.default.http[0])

    this._walletClient = createWalletClient({
      account,
      chain: hardhat,
      transport,
    })

    this._publicClient = createPublicClient({
      chain: hardhat,
      transport,
    })

    this._address = account.address
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
