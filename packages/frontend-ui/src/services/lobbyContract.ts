import type { PublicClient, WalletClient } from 'viem'
import { MY_PAIMA_L2_ABI } from '../contracts/MyPaimaL2Abi'

// Deployed on local Hardhat network (chain-31337).
// Source: packages/shared/contracts/evm/ignition/deployments/chain-31337/deployed_addresses.json
const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const

export interface GameInfo {
  id: number
  state: 'Open' | 'Closed'
  playerCount: number
  maxPlayers: number
}

export async function getGameState(
  publicClient: PublicClient,
  gameId: number,
): Promise<GameInfo> {
  const result = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: MY_PAIMA_L2_ABI,
    functionName: 'getGame',
    args: [BigInt(gameId)],
  })

  return {
    id: Number(result[0]),
    state: result[1] === 0 ? 'Open' : 'Closed',
    playerCount: Number(result[2]),
    maxPlayers: Number(result[3]),
  }
}

/**
 * Derives a deterministic bytes32 value from the player's EVM address using
 * SHA-256 via the browser's native crypto.subtle API.
 *
 * TODO: Replace with the player's actual Midnight shielded address hash once
 * Midnight wallet integration is added to this UI.
 */
export async function deriveMidnightAddressHash(
  evmAddress: `0x${string}`,
): Promise<`0x${string}`> {
  const encoder = new TextEncoder()
  const data = encoder.encode(evmAddress.toLowerCase())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as `0x${string}`
}

export async function joinGame(
  gameId: number,
  midnightAddressHash: `0x${string}`,
  walletClient: WalletClient,
  publicClient: PublicClient,
  account: `0x${string}`,
): Promise<{ success: boolean }> {
  const { request } = await publicClient.simulateContract({
    address: CONTRACT_ADDRESS,
    abi: MY_PAIMA_L2_ABI,
    functionName: 'joinGame',
    args: [BigInt(gameId), midnightAddressHash as `0x${string}`],
    account,
  })

  const hash = await walletClient.writeContract(request)
  await publicClient.waitForTransactionReceipt({ hash })

  return { success: true }
}
