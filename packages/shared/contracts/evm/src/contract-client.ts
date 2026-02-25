import {
  type Chain,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
} from "npm:viem";
import { mypaimal2contract as MyPaimaL2Contract } from "@werewolf-game/evm-contracts";
import myPaimaL2Abi from "@werewolf-game/evm-contracts/artifacts/hardhat/contracts/MyPaimaL2Contract.sol/MyPaimaL2Contract.json";

// Create ABI type
type MyPaimaL2ContractAbi = typeof myPaimaL2Abi;

// Client interface
export interface WerewolfContractClient {
  chain: Chain;
  contractAddress: `0x${string}`;
  createGame(maxPlayers: number): Promise<{ gameId: bigint }>;
  joinGame(
    gameId: number,
    midnightAddressHash: string,
  ): Promise<{ success: boolean }>;
  closeGame(gameId: number): Promise<{ success: boolean }>;
  getGame(gameId: number): Promise<{
    id: bigint;
    state: 0 | 1; // 0 = Open, 1 = Closed
    playerCount: bigint;
    maxPlayers: bigint;
  }>;
  getPlayers(
    gameId: number,
  ): Promise<Array<{ evmAddress: string; midnightAddressHash: string }>>;
}

// Create contract client
export function createContractClient(
  chain: Chain,
  contractAddress: string,
  rpcUrl: string,
): WerewolfContractClient {
  // Use viem transport for HTTP connection
  const transport = http(rpcUrl);

  const publicClient = createPublicClient({
    chain,
    transport,
  });

  const walletClient = createWalletClient({
    chain,
    transport,
  });

  const abi = parseAbi(myPaimaL2ContractAbi) as MyPaimaL2ContractAbi;

  return {
    chain,
    contractAddress,

    createGame: async (maxPlayers: number) => {
      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "createGame",
        args: [maxPlayers],
      });

      const hash = await walletClient.writeContract(request);

      // Extract gameId from GameCreated event logs
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Find GameCreated event
      const gameCreatedLog = receipt.logs.find((log: any) => {
        return log.eventName === "GameCreated";
      });

      if (!gameCreatedLog || !("args" in gameCreatedLog)) {
        throw new Error("GameCreated event not found in receipt");
      }

      const gameId = gameCreatedLog.args[0] as bigint;

      return { gameId };
    },

    joinGame: async (gameId: number, midnightAddressHash: string) => {
      // Convert string midnight address hash to bytes32
      const midnightHashBytes32 = midnightAddressHash.startsWith("0x")
        ? midnightAddressHash.slice(2) as `0x${string}`
        : midnightAddressHash;

      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "joinGame",
        args: [gameId, midnightHashBytes32],
      });

      const hash = await walletClient.writeContract(request);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Find PlayerJoined event
      const playerJoinedLog = receipt.logs.find((log: any) => {
        return log.eventName === "PlayerJoined";
      });

      if (!playerJoinedLog) {
        return { success: false };
      }

      // Verify caller's address matches (from event)
      const playerEvmAddress = (playerJoinedLog as any)
        .args[1] as `0x${string}`;
      // Note: We can't verify msg.sender here as we're not the sender
      // The contract stores msg.sender automatically

      return { success: true };
    },

    closeGame: async (gameId: number) => {
      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "closeGame",
        args: [gameId],
      });

      const hash = await walletClient.writeContract(request);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Find GameClosed event
      const gameClosedLog = receipt.logs.find((log: any) => {
        return log.eventName === "GameClosed";
      });

      if (!gameClosedLog) {
        return { success: false };
      }

      return { success: true };
    },

    getGame: async (gameId: number) => {
      const result = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "getGame",
        args: [gameId],
      });

      return {
        id: result[0] as bigint,
        state: result[1] as 0 | 1,
        playerCount: result[2] as bigint,
        maxPlayers: result[3] as bigint,
      };
    },

    getPlayers: async (gameId: number) => {
      const result = await publicClient.readContract({
        address: contractAddress as `0x${string}`,
        abi,
        functionName: "getPlayers",
        args: [gameId],
      });

      // Convert array to objects
      return result.map((player: any) => ({
        evmAddress: player[0],
        midnightAddressHash: player[1],
      }));
    },
  };
}

// Helper function to create a wallet client (for transactions)
function createWalletClient(config: Parameters<typeof createPublicClient>) {
  return createWalletClient(config);
}

// Helper to convert GameState enum to/from number
function gameStateToNumber(state: 0 | 1): 0 | 1 {
  return state;
}

function numberToGameState(num: number): 0 | 1 {
  return num as 0 | 1;
}
