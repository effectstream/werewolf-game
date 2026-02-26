import { useEvmWallet } from "../contexts/EvmWalletContext";
import { type LoginInfo, WalletMode } from "@paimaexample/wallets";
import { createWalletClient, http, privateKeyToAccount } from "viem";
import { hardhat } from "viem/chains";

interface WalletModalProps {
  onClose: () => void;
}

// Helper function to generate a local wallet with Viem
async function getLocalWallet() {
  // For local development, use a predefined test key from Hardhat
  // WARNING: This is a well-known test key with no real value
  // NEVER use this or any hardcoded key in production!
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

export function WalletModal({ onClose }: WalletModalProps) {
  const { connectEvmWallet } = useEvmWallet();

  const handleConnect = async (mode: WalletMode) => {
    try {
      if (mode === WalletMode.EvmEthers) {
        // This branch handles programmatically created wallets
        const localWallet = await getLocalWallet();

        // LoginInfo for EvmEthers mode requires:
        // - mode: WalletMode.EvmEthers
        // - connection: ActiveConnection<EthersApi> with metadata and api
        // - preferBatchedMode: boolean
        const loginInfo: LoginInfo = {
          mode: WalletMode.EvmEthers,
          connection: {
            metadata: {
              name: "viem.localwallet",
              displayName: "Local Wallet",
            },
            api: localWallet,
          },
          preferBatchedMode: true,
        };
        await connectEvmWallet(loginInfo);
      } else {
        // This branch handles browser extension wallets like MetaMask
        // LoginInfo for EvmInjected mode requires:
        // - mode: WalletMode.EvmInjected
        // - preferBatchedMode: boolean
        // - checkChainId: boolean (optional, defaults to true)
        // - chain: Chain (optional, the Viem chain configuration)
        const loginInfo: LoginInfo = {
          mode: WalletMode.EvmInjected,
          preferBatchedMode: true,
          checkChainId: true,
          chain: hardhat,
        };
        await connectEvmWallet(loginInfo);
      }
      onClose();
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      // In production, you'd want to show this error to the user
      alert(
        `Failed to connect wallet: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  return (
    <div className="wallet-modal-overlay">
      <div className="wallet-modal-content">
        <button
          onClick={onClose}
          className="wallet-modal-close"
        >
          &times;
        </button>
        <h2 className="wallet-modal-title">Connect EVM Wallet</h2>
        <p className="wallet-modal-subtitle">
          Choose your preferred wallet to continue
        </p>
        <div className="wallet-options">
          <button
            onClick={() => handleConnect(WalletMode.EvmInjected)}
            className="wallet-option-button metamask"
          >
            Connect Browser Wallet (MetaMask)
          </button>
          <button
            onClick={() => handleConnect(WalletMode.EvmEthers)}
            className="wallet-option-button local-wallet"
          >
            Connect Local Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
