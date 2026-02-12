import {
  Contract as Werewolf,
  witnesses as werewolfWitnesses,
} from "../../../../../shared/contracts/midnight/contract-werewolf/src/_index.ts";

// import { balanceOf as balanceOfQuery } from "./balanceOf.ts";
import * as ledger from "@midnight-ntwrk/ledger-v7";

import { type ContractAddress } from "@midnight-ntwrk/compact-runtime";

// import {
//   type CoinInfo,
//   Transaction,
//   type TransactionId,
// } from "@midnight-ntwrk/ledger";
import type {
  CoinPublicKey,
  EncPublicKey,
  // FinalizedTransaction,
  ShieldedCoinInfo,
  // UnprovenTransaction,
} from "@midnight-ntwrk/ledger-v7";
import {
  type DeployedContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { CompiledContract } from "@midnight-ntwrk/compact-js";

import {
  type BalancedProvingRecipe,
  // Contract,
  type ImpureCircuitId,
  type MidnightProvider,
  type MidnightProviders,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { type Resource, WalletBuilder } from "@midnight-ntwrk/wallet";
import type { Wallet } from "@midnight-ntwrk/wallet-api";
// import { Transaction as ZswapTransaction } from "@midnight-ntwrk/zswap";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { assertIsContractAddress } from "@midnight-ntwrk/midnight-js-utils";
// import {
//   getNetworkId,
//   setNetworkId,
// } from "@midnight-ntwrk/midnight-js-network-id";
// import { dirname, resolve } from "node:path";
// import {
//   MidnightBech32m,
//   ShieldedAddress,
// } from "@midnight-ntwrk/wallet-sdk-address-format";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { NetworkId } from "@midnight-ntwrk/midnight-js-network-id";
// import {
//   catchError,
//   concatMap,
//   filter,
//   firstValueFrom,
//   interval,
//   map,
//   of,
//   take,
//   tap,
//   throwError,
//   timeout,
// } from "rxjs";
// import { pipe as fnPipe } from "fp-ts/function";
import semver from "semver";
import {
  fromHex,
  // ShieldedCoinInfo,
  toHex,
} from "@midnight-ntwrk/compact-runtime";

// const BASE_URL_MIDNIGHT_NODE_A = `http://127.0.0.1:9944`;
// const getMidnightNodeUrl = async (): Promise<string> => {
//   return BASE_URL_MIDNIGHT_NODE_A;
// };

const BASE_URL_MIDNIGHT_INDEXER = `http://127.0.0.1:8088`;
const BASE_WS_MIDNIGHT_INDEXER = `ws://127.0.0.1:8088`;
const BASE_URL_PROOF_SERVER = `http://127.0.0.1:6300`;
const BASE_URL_MIDNIGHT_INDEXER_API =
  `${BASE_URL_MIDNIGHT_INDEXER}/api/v1/graphql`;
const BASE_URL_MIDNIGHT_INDEXER_WS =
  `${BASE_WS_MIDNIGHT_INDEXER}/api/v1/graphql/ws`;

const MIDNIGHT_NETWORK_ID: NetworkId = "undeployed";

type ShieldedAddresses = Awaited<
  ReturnType<ConnectedAPI["getShieldedAddresses"]>
>;

type ContractPrivateStateId = "werewolfPrivateState";

type WerewolfContract = Werewolf.Contract;

// Inlined common types for standalone script
type WerewolfCircuits = ImpureCircuitId<WerewolfContract>;

export type WerewolfProviders = MidnightProviders<
  WerewolfCircuits,
  ContractPrivateStateId,
  {}
>;

type DeployedWerewolfContract =
  | DeployedContract<WerewolfContract>
  | FoundContract<WerewolfContract>;

// Inlined config for standalone script
// const currentDir = resolve(dirname(new URL(import.meta.url).pathname));

// interface Config {
//   readonly logDir: string;
//   readonly indexer: string;
//   readonly indexerWS: string;
//   readonly node: string;
//   readonly proofServer: string;
// }

// class StandaloneConfig implements Config {
//   logDir = resolve(
//     currentDir,
//     "..",
//     "logs",
//     "standalone",
//     `${new Date().toISOString()}.log`,
//   );
//   indexer = BASE_URL_MIDNIGHT_INDEXER_API;
//   indexerWS = BASE_URL_MIDNIGHT_INDEXER_WS;
//   node: string;
//   proofServer = BASE_URL_PROOF_SERVER;
//   constructor(nodeUrl: string) {
//     this.node = nodeUrl;
//     setNetworkId(MIDNIGHT_NETWORK_ID);
//   }
// }

const werewolfContractInstance = new Werewolf.Contract(werewolfWitnesses);

const getWerewolfLedgerState = async (
  providers: WerewolfProviders,
  contractAddress: ContractAddress,
): Promise<any | null> => {
  assertIsContractAddress(contractAddress);
  console.log("🔍 Checking contract ledger state...");

  try {
    const contractState = await providers.publicDataProvider.queryContractState(
      contractAddress,
    );
    const state = contractState != null
      ? Werewolf.ledger(contractState.data)
      : null;
    console.log(`📊 Ledger state:`, state);
    return state;
  } catch (error) {
    console.error("❌ Error getting Werewolf ledger state:", error);
    throw error;
  }
};

const joinContract = async (
  providers: WerewolfProviders,
  contractAddress: string,
): Promise<DeployedWerewolfContract> => {
  const compiledContract = CompiledContract.withCompiledFileAssets(
    CompiledContract.withWitnesses(
      CompiledContract.make("werewolf", Werewolf.Contract),
      werewolfWitnesses
    ),
    "../../../../shared/contracts/midnight/contract-werewolf/src/managed"
  );

  const werewolfContract = await findDeployedContract(providers, {
    contractAddress,
    privateStateId: "werewolfPrivateState",
    compiledContract,
    initialPrivateState: {},
  });
  console.log(
    `Joined contract at address: ${
      (werewolfContract as any).deployTxData.public.contractAddress
    }`,
  );
  // console.log("werewolfContract", werewolfContract);
  return werewolfContract;
};

// const balanceOf = async (account: string): Promise<bigint> => {
//   return await balanceOfQuery(account);
// };

const displayWerewolfLedgerState = async (
  providers: WerewolfProviders,
  werewolfContract: DeployedWerewolfContract,
): Promise<{ state: any | null; contractAddress: string }> => {
  const contractAddress =
    (werewolfContract as any).deployTxData.public.contractAddress;
  const state = await getWerewolfLedgerState(providers, contractAddress);
  return { contractAddress, state };
};

type WerewolfMethodArgType =
  | "bytes32"
  | "bytes33"
  | "bytes129"
  | "uint32"
  | "uint8"
  | "boolean"
  | "coinPublicKey"
  | "merkleDigest"
  | "merklePath"
  | "coinPublicKeyVec10"
  | "curvePointVec10";

type WerewolfMethodCaller = "trustedNode" | "player" | "any";

export type WerewolfMethodSpec = {
  name: string;
  caller: WerewolfMethodCaller;
  args: { name: string; type: WerewolfMethodArgType }[];
};

export const WEREWOLF_METHODS = [
  {
    name: "createGame",
    caller: "trustedNode",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "adminKey", type: "coinPublicKey" },
      { name: "adminVotePublicKey", type: "bytes33" },
      { name: "masterSecretCommitment", type: "bytes32" },
      { name: "actualCount", type: "uint32" },
      { name: "werewolfCount", type: "uint32" },
      { name: "initialRoot", type: "merkleDigest" },
    ],
  },
  {
    name: "forceEndGame",
    caller: "trustedNode",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "masterSecret", type: "bytes32" },
    ],
  },
  {
    name: "nightAction",
    caller: "player",
    args: [
      { name: "gameId", type: "uint32" },
    ],
  },
  {
    name: "resolveNightPhase",
    caller: "trustedNode",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "newRound", type: "uint32" },
      { name: "deadPlayerIdx", type: "uint32" },
      { name: "hasDeath", type: "boolean" },
      { name: "newMerkleRoot", type: "merkleDigest" },
    ],
  },
  {
    name: "voteDay",
    caller: "player",
    args: [
      { name: "gameId", type: "uint32" },
    ],
  },
  {
    name: "resolveDayPhase",
    caller: "trustedNode",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "eliminatedIdx", type: "uint32" },
      { name: "hasElimination", type: "boolean" },
    ],
  },
  {
    name: "revealPlayerRole",
    caller: "player",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "playerIdx", type: "uint32" },
      { name: "role", type: "uint8" },
      { name: "salt", type: "bytes32" },
    ],
  },
  {
    name: "verifyFairness",
    caller: "player",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "masterSecret", type: "bytes32" },
      { name: "playerIdx", type: "uint32" },
      { name: "assignedRole", type: "uint8" },
    ],
  },
  {
    name: "getEncryptedVotesForRound",
    caller: "any",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "phase", type: "uint8" },
      { name: "round", type: "uint32" },
    ],
  },
  {
    name: "getGameAdminPublicKey",
    caller: "any",
    args: [{ name: "gameId", type: "uint32" }],
  },
  {
    name: "getGameState",
    caller: "any",
    args: [{ name: "gameId", type: "uint32" }],
  },
  {
    name: "isPlayerAlive",
    caller: "any",
    args: [
      { name: "gameId", type: "uint32" },
      { name: "playerIdx", type: "uint32" },
    ],
  },
  {
    name: "getAdminKey",
    caller: "any",
    args: [{ name: "gameId", type: "uint32" }],
  },
  {
    name: "testComputeCommitment",
    caller: "any",
    args: [
      { name: "role", type: "uint8" },
      { name: "salt", type: "bytes32" },
    ],
  },
  {
    name: "testComputeHash",
    caller: "any",
    args: [{ name: "data", type: "bytes32" }],
  },
  {
    name: "testComputeSalt",
    caller: "any",
    args: [
      { name: "masterSecret", type: "bytes32" },
      { name: "playerIdx", type: "uint32" },
    ],
  },
] as const satisfies ReadonlyArray<WerewolfMethodSpec>;

export type WerewolfMethodName = (typeof WEREWOLF_METHODS)[number]["name"];

export type WerewolfMethodArgValue =
  | Uint8Array
  | bigint
  | boolean
  | { bytes: Uint8Array }
  | { field: bigint }
  | {
    leaf: Uint8Array;
    path: { sibling: { field: bigint }; goes_left: boolean }[];
  }
  | { bytes: Uint8Array }[]
  | Uint8Array[]
  | { x: bigint; y: bigint }[];

const getCallTx = (contract: DeployedWerewolfContract) => {
  const callTx = (contract as any).callTx;

  if (!callTx || typeof callTx !== "object") {
    throw new Error("Contract callTx is not available on this instance.");
  }
  return callTx as Record<
    string,
    (...args: WerewolfMethodArgValue[]) => unknown
  >;
};

const ensureMethodExists = (method: WerewolfMethodName, callTx: any) => {
  if (typeof callTx[method] !== "function") {
    throw new Error(`Contract method not found: ${method}`);
  }
};

export const callWerewolfMethod = async (
  contract: DeployedWerewolfContract,
  method: WerewolfMethodName,
  args: WerewolfMethodArgValue[],
): Promise<any> => {
  const callTx = getCallTx(contract);
  ensureMethodExists(method, callTx);
  return await callTx[method](...args);
};

const connectToWallet = async (networkId: string): Promise<ConnectedAPI> => {
  const COMPATIBLE_CONNECTOR_API_VERSION = ">=1.0.0";
  const midnight = (window as any).midnight;

  if (!midnight) {
    throw new Error("Midnight Lace wallet not found. Extension installed?");
  }

  const wallets = Object.entries(midnight).filter(([_, api]: [string, any]) =>
    api.apiVersion &&
    semver.satisfies(api.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)
  ) as [string, any][];

  if (wallets.length === 0) {
    throw new Error("No compatible Midnight wallet found.");
  }

  const [name, api] = wallets[0];
  console.log(`Connecting to wallet: ${name} (version ${api.apiVersion})`);

  // KEY: Hardcoded Password Provider
  const passwordProvider = async () => "PAIMA_STORAGE_PASSWORD";

  const apiWithPassword: any = { ...api };
  if (typeof apiWithPassword.connect !== "function") {
    apiWithPassword.connect = api.connect;
  }
  apiWithPassword.privateStoragePasswordProvider = passwordProvider;

  return await apiWithPassword.connect(networkId);
};

const createWalletAndMidnightProvider = (
  connectedAPI: ConnectedAPI,
  coinPublicKey: CoinPublicKey,
  encryptionPublicKey: EncPublicKey,
): WalletProvider & MidnightProvider => {
  return {
    getCoinPublicKey(): CoinPublicKey {
      return coinPublicKey;
    },
    getEncryptionPublicKey(): EncPublicKey {
      return encryptionPublicKey;
    },
    // async balanceTx(
    //   tx: UnprovenTransaction,
    //   _newCoins?: ShieldedCoinInfo[],
    //   _ttl?: Date,
    // ): Promise<BalancedProvingRecipe> {
    //   console.log("balanceTx", tx);
    //   console.log("connectedAPI", connectedAPI);
    //   const serializedTx = tx.serialize();
    //   const hexTx = Array.from(serializedTx)
    //     .map((b) => b.toString(16).padStart(2, "0"))
    //     .join("");
    //   console.log("hexTx", hexTx);
    //   const result = await connectedAPI.balanceUnsealedTransaction(hexTx);
    //   console.log("result", result);
    //   return result as unknown as BalancedProvingRecipe;
    // },
    async balanceTx(
      tx: ledger.UnprovenTransaction,
      newCoins?: ShieldedCoinInfo[],
      ttl?: Date,
    ): Promise<BalancedProvingRecipe> {
      try {
        console.log(
          { tx, newCoins, ttl },
          "Balancing transaction via wallet",
        );
        const serializedTx = toHex(tx.serialize());
        const received = await connectedAPI.balanceUnsealedTransaction(
          serializedTx,
        );
        const transaction: ledger.Transaction<
          ledger.SignatureEnabled,
          ledger.PreProof,
          ledger.PreBinding
        > = ledger.Transaction.deserialize<
          ledger.SignatureEnabled,
          ledger.PreProof,
          ledger.PreBinding
        >(
          "signature",
          "pre-proof",
          "pre-binding",
          fromHex(received.tx),
        );
        return {
          type: "TransactionToProve",
          transaction: transaction,
        };
      } catch (e) {
        console.error(
          { error: e },
          "Error balancing transaction via wallet",
        );
        throw e;
      }
    },
    submitTx: async (
      tx: ledger.FinalizedTransaction,
    ): Promise<ledger.TransactionId> => {
      await connectedAPI.submitTransaction(toHex(tx.serialize()));
      const txIdentifiers = tx.identifiers();
      const txId = txIdentifiers[0]; // Return the first transaction ID
      console.log(
        { txIdentifiers },
        "Submitted transaction via wallet",
      );
      return txId;
    },
    // submitTx(tx: BalancedProvingRecipe): Promise<TransactionId> {
    //   const serializedTx = tx.serialize();
    //   const hexTx = Array.from(serializedTx)
    //     .map((b) => b.toString(16).padStart(2, "0"))
    //     .join("");

    //   return connectedAPI.submitTransaction(hexTx) as unknown as Promise<
    //     TransactionId
    //   >;
    // },
  };
};

const initializeProviders = async (
  connectedAPI: ConnectedAPI,
  shieldedAddresses: ShieldedAddresses,
): Promise<WerewolfProviders> => {
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } =
    shieldedAddresses;

  console.log(`Connecting to wallet with network ID: ${MIDNIGHT_NETWORK_ID}`);

  const walletAndMidnightProvider = createWalletAndMidnightProvider(
    connectedAPI,
    shieldedCoinPublicKey as any,
    shieldedEncryptionPublicKey as any,
  );

  const zkConfigPath = window.location.origin;

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStoragePasswordProvider: async () => "PAIMA_STORAGE_PASSWORD",
    } as any),
    zkConfigProvider: new FetchZkConfigProvider(
      zkConfigPath,
      fetch.bind(window),
    ),
    proofProvider: httpClientProofProvider(BASE_URL_PROOF_SERVER),
    publicDataProvider: indexerPublicDataProvider(
      BASE_URL_MIDNIGHT_INDEXER_API,
      BASE_URL_MIDNIGHT_INDEXER_WS,
    ),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

const configureProviders = async (
  connectedAPI: ConnectedAPI,
  injectedWallet: Wallet & Resource,
) => {
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();
  const providers = await initializeProviders(connectedAPI, shieldedAddresses);
  return {
    ...providers,
    injectedWalletProvider: injectedWallet,
  };
};

// class MidnightAlternativeLogin {
//   private initializedProviders:
//     | Promise<MultiChainMultiTokenProviders>
//     | undefined;
//   private logger = {
//     info: (...message: any[]) => console.log(...message),
//     error: (...message: any[]) => console.error(...message),
//   };

//   constructor() {}

//   public getProviders(): Promise<MultiChainMultiTokenProviders> {
//     // We use a cached `Promise` to hold the providers. This will:
//     //
//     // 1. Cache and re-use the providers (including the configured connector API), and
//     // 2. Act as a synchronization point if multiple contract deploys or joins run concurrently.
//     //    Concurrent calls to `getProviders()` will receive, and ultimately await, the same
//     //    `Promise`.
//     return (
//       this.initializedProviders ??
//         (this.initializedProviders = this.initializeProviders())
//     );
//   }

//   /** @internal */
//   private async initializeProviders(): Promise<MultiChainMultiTokenProviders> {
//     const { wallet, uris } = await this.connectToWallet();
//     const walletState = await wallet.state();
//     const zkConfigPath = window.location.origin; // '../../../contract/src/managed/bboard';

//     console.log(
//       `Connecting to wallet with network ID: ${getLedgerNetworkId()}`,
//     );

//     return {
//       privateStateProvider: levelPrivateStateProvider({}),
//       zkConfigProvider: new FetchZkConfigProvider(
//         zkConfigPath,
//         fetch.bind(window),
//       ),
//       proofProvider: httpClientProofProvider(uris.proverServerUri),
//       publicDataProvider: indexerPublicDataProvider(
//         uris.indexerUri,
//         uris.indexerWsUri,
//       ),
//       walletProvider: {
//         coinPublicKey: walletState.coinPublicKey,
//         encryptionPublicKey: walletState.encryptionPublicKey,
//         balanceTx(
//           tx: UnbalancedTransaction,
//           newCoins: CoinInfo[],
//         ): Promise<BalancedTransaction> {
//           return wallet
//             .balanceAndProveTransaction(
//               ZswapTransaction.deserialize(
//                 tx.serialize(getLedgerNetworkId()),
//                 getZswapNetworkId(),
//               ),
//               newCoins,
//             )
//             .then((zswapTx: any) =>
//               Transaction.deserialize(
//                 zswapTx.serialize(getZswapNetworkId()),
//                 getLedgerNetworkId(),
//               )
//             )
//             .then(createBalancedTx);
//         },
//       },
//       midnightProvider: {
//         submitTx(tx: BalancedTransaction): Promise<TransactionId> {
//           return wallet.submitTransaction(tx);
//         },
//       },
//     };
//   }

//   /** @internal */
//   private async connectToWallet(): Promise<{
//     wallet: DAppConnectorWalletAPI;
//     uris: ServiceUriConfig;
//   }> {
//     const COMPATIBLE_CONNECTOR_API_VERSION = "1.x";

//     return firstValueFrom(
//       fnPipe(
//         interval(100),
//         map(() => window.midnight?.mnLace),
//         tap((connectorAPI) => {
//           this.logger.info(connectorAPI, "Check for wallet connector API");
//         }),
//         filter(
//           (connectorAPI): connectorAPI is DAppConnectorAPI => !!connectorAPI,
//         ),
//         concatMap((connectorAPI) =>
//           semver.satisfies(
//               connectorAPI.apiVersion,
//               COMPATIBLE_CONNECTOR_API_VERSION,
//             )
//             ? of(connectorAPI)
//             : throwError(() => {
//               this.logger.error(
//                 {
//                   expected: COMPATIBLE_CONNECTOR_API_VERSION,
//                   actual: connectorAPI.apiVersion,
//                 },
//                 "Incompatible version of wallet connector API",
//               );

//               return new Error(
//                 `Incompatible version of Midnight Lace wallet found. Require '${COMPATIBLE_CONNECTOR_API_VERSION}', got '${connectorAPI.apiVersion}'.`,
//               );
//             })
//         ),
//         tap((connectorAPI) => {
//           this.logger.info(
//             connectorAPI,
//             "Compatible wallet connector API found. Connecting.",
//           );
//         }),
//         take(1),
//         timeout({
//           first: 1_000,
//           with: () =>
//             throwError(() => {
//               this.logger.error("Could not find wallet connector API");

//               return new Error(
//                 "Could not find Midnight Lace wallet. Extension installed?",
//               );
//             }),
//         }),
//         concatMap(async (connectorAPI) => {
//           const isEnabled = await connectorAPI.isEnabled();

//           this.logger.info(isEnabled, "Wallet connector API enabled status");

//           return connectorAPI;
//         }),
//         timeout({
//           first: 5_000,
//           with: () =>
//             throwError(() => {
//               this.logger.error("Wallet connector API has failed to respond");

//               return new Error(
//                 "Midnight Lace wallet has failed to respond. Extension enabled?",
//               );
//             }),
//         }),
//         concatMap(async (connectorAPI) => ({
//           walletConnectorAPI: await connectorAPI.enable(),
//           connectorAPI,
//         })),
//         catchError((error, apis) =>
//           error
//             ? throwError(() => {
//               this.logger.error("Unable to enable connector API");
//               return new Error("Application is not authorized");
//             })
//             : apis
//         ),
//         concatMap(async ({ walletConnectorAPI, connectorAPI }) => {
//           const uris = await connectorAPI.serviceUriConfig();

//           this.logger.info(
//             "Connected to wallet connector API and retrieved service configuration",
//           );

//           return { wallet: walletConnectorAPI, uris };
//         }),
//       ),
//     );
//   }
// }

/**
 * Get contract address from command line arguments or from a file
 */
const getContractAddress = async (): Promise<string> => {
  const r = await fetch(
    "contract_address/contract-werewolf.undeployed.json",
  );
  const json = await r.json();
  console.log("🔍 Contract address:", json.contractAddress);
  return json.contractAddress;
};

const connectMidnightWallet = async (
  connectedAPI: ConnectedAPI,
): Promise<{
  providers: WerewolfProviders;
  addresses: ShieldedAddresses;
}> => {
  console.log("🔗 Building Midnight wallet with v4 connector...");

  const addresses = await connectedAPI.getShieldedAddresses();
  const providers = await initializeProviders(connectedAPI, addresses);
  console.log("✅ Providers configured successfully");

  return { providers, addresses };
};

const connectToContract = async (
  providers: WerewolfProviders,
  contractAddress?: string,
): Promise<{
  contract: DeployedWerewolfContract;
  state: any | null;
  contractAddress: string;
}> => {
  const address = contractAddress || (await getContractAddress());
  console.log(`🔗 Joining Werewolf contract at address: ${address}`);

  const contract = await joinContract(providers, address);
  console.log("✅ Successfully joined the Werewolf contract");

  // Get initial state
  const currentState = await displayWerewolfLedgerState(providers, contract);
  console.log(`📊 Current state value:`, currentState);

  return {
    contract,
    state: currentState.state,
    contractAddress: currentState.contractAddress,
  };
};

export { connectMidnightWallet, connectToContract };
