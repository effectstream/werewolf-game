// ABI extracted from packages/shared/contracts/evm/build/artifacts/hardhat/src/contracts/MyPaimaL2.sol/MyPaimaL2Contract.json
// Only includes the functions needed by the player lobby UI.
export const MY_PAIMA_L2_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: '_gameId', type: 'uint256' },
      { internalType: 'bytes32', name: '_midnightAddressHash', type: 'bytes32' },
    ],
    name: 'joinGame',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_gameId', type: 'uint256' }],
    name: 'getGame',
    outputs: [
      { internalType: 'uint256', name: 'id', type: 'uint256' },
      { internalType: 'uint8', name: 'state', type: 'uint8' },
      { internalType: 'uint256', name: 'playerCount', type: 'uint256' },
      { internalType: 'uint256', name: 'maxPlayers', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '_gameId', type: 'uint256' }],
    name: 'isGameOpen',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: '_gameId', type: 'uint256' },
      { internalType: 'address', name: '_player', type: 'address' },
    ],
    name: 'hasPlayerJoined',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'gameId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'evmAddress', type: 'address' },
      { indexed: false, internalType: 'bytes32', name: 'midnightAddressHash', type: 'bytes32' },
    ],
    name: 'PlayerJoined',
    type: 'event',
  },
] as const
