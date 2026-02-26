import { createContext, type ReactNode, useContext, useState } from "react";
import {
  type LoginInfo,
  type Wallet,
  walletLogin,
  WalletMode,
} from "@paimaexample/wallets";
import { createWalletClient, http, privateKeyToAccount } from "viem";
import { hardhat } from "viem/chains";

// Define the shape of your wallet context
interface EvmWalletContextType {
  isConnected: boolean; // Whether a wallet is currently connected
  address: string | null; // The user's wallet address (null when disconnected)
  wallet: Wallet | null; // The wallet instance (contains provider, address, metadata)
  connectEvmWallet: (loginInfo: LoginInfo) => Promise<void>; // Method to connect
  isModalOpen: boolean; // Controls the wallet selection modal visibility
  openModal: () => void; // Opens the wallet selection modal
  closeModal: () => void; // Closes the wallet selection modal
}

// Create the context with undefined as default - this forces proper provider usage
const EvmWalletContext = createContext<EvmWalletContextType | undefined>(
  undefined,
);

// Create a custom hook for accessing the wallet context
export function useEvmWallet() {
  const context = useContext(EvmWalletContext);
  if (context === undefined) {
    throw new Error("useEvmWallet must be used within an EvmWalletProvider");
  }
  return context;
}

interface EvmWalletProviderProps {
  children: ReactNode;
}

// Helper function to generate a local wallet with Viem
async function getLocalWallet() {
  // For local development, use a predefined test key
  // In production, you'd generate a fresh key and store it securely
  const privateKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  const account = privateKeyToAccount(privateKey);

  // Create a wallet client that can sign transactions
  const walletClient = createWalletClient({
    account,
    chain: hardhat,
    transport: http("http://127.0.0.1:8545"),
  });

  return walletClient;
}

export function EvmWalletProvider({ children }: EvmWalletProviderProps) {
  // State management for wallet connection
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Modal control functions
  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  // The core connection method that handles wallet authentication
  const connectEvmWallet = async (loginInfo: LoginInfo) => {
    // walletLogin is provided by the Paima wallet framework
    // It delegates to mode-specific wrapper functions based on loginInfo.mode
    const response = await walletLogin(loginInfo);

    if (response.success) {
      // The Wallet object contains:
      // - provider: IProvider<unknown> - handles signing and address retrieval
      // - walletAddress: string - the user's wallet address
      // - metadata: WalletOption - name, displayName, and optional icon
      setWallet(response.result);
      setAddress(response.result.walletAddress);
      setIsConnected(true);
      closeModal();
      console.log("EVM Wallet connected:", response.result.walletAddress);
    } else {
      // Propagate errors up to the calling component
      console.error("Failed to connect EVM wallet:", response.errorMessage);
      throw new Error(response.errorMessage);
    }
  };

  // Package everything into the context value
  const value: EvmWalletContextType = {
    isConnected,
    address,
    wallet,
    connectEvmWallet,
    isModalOpen,
    openModal,
    closeModal,
  };

  return (
    <EvmWalletContext.Provider value={value}>
      {children}
    </EvmWalletContext.Provider>
  );
}
