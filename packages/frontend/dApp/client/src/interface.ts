import { walletLogin, WalletMode } from "@paimaexample/wallets";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

import * as midnightContract from "./contracts/contract.ts";
// import * as erc7683 from "./contracts/intents.ts";

export async function loginMidnight() {
  const result = await walletLogin({
    // Avoid referencing a (const) enum at runtime when `isolatedModules` is enabled.
    // The wallet lib accepts the string mode as well.
    // @ts-ignore - isolatedModules
    mode: WalletMode.Midnight,
    networkId: "undeployed",
  });

  if (!result.success) {
    console.log("loginMidnight: walletLogin failed", result);
    throw new Error("Cannot login");
  }
  const paimaWallet = result.result;

  const response = {
    addr: "",
    unshieldedAddr: "",
    contract: {
      werewolf: null,
      erc7683: null,
    },
    contractAddress: {
      werewolf: "",
      erc7683: "",
    },
    stateA: {
      werewolf: null,
      erc7683: null,
    },
    stateB: {
      werewolf: null,
      erc7683: null,
    },
    providers: null,
    addresses: null,
    wallet: null,
  } as any;

  {
    const connectedApi = paimaWallet.provider.getConnection()
      .api as ConnectedAPI;
    const { providers, addresses } = await midnightContract
      .connectMidnightWallet(connectedApi);

    response.stateA.werewolf = addresses;
    response.addr = addresses.shieldedAddress;
    response.providers = providers;
    response.addresses = addresses;

    const {
      contract,
      state: state2,
      contractAddress,
    } = await midnightContract.connectToContract(providers);
    response.contract.werewolf = contract;
    response.stateB.werewolf = state2;
    response.contractAddress.werewolf = contractAddress;
  }
  // {
  //   const connectedApi = paimaWallet.provider.getConnection()
  //     .api as ConnectedAPI;
  //   const { providers, addresses } = await erc7683.connectMidnightWallet(
  //     connectedApi,
  //   );

  //   response.stateA.erc7683 = addresses;
  //   response.addr = addresses.shieldedAddress;
  //   response.unshieldedAddr = addresses.unshieldedAddress;

  //   const {
  //     contract: erc7683Contract,
  //     state: erc7683State,
  //     contractAddress: erc7683ContractAddress,
  //   } = await erc7683.connectToContract(providers);
  //   response.contract.erc7683 = erc7683Contract;
  //   response.stateB.erc7683 = erc7683State;
  //   response.contractAddress.erc7683 = erc7683ContractAddress;
  // }

  return response;
}

// export async function genericCall(contract: any, addr: string, amount: bigint) {
//   try {
//     console.log("Generic Call", contract, addr);
//     return await midnightContract[function](..args);
//   } catch (error) {
//     console.error(0, { error });
//     throw error;
//   }
// }

// export async function midnight_balanceOf(contract: any, addr: string) {
//   try {
//     console.log("Balance of", contract, addr);
//     return await midnightContract.balanceOf(addr);
//   } catch (error) {
//     console.error(0, { error });
//     throw error;
//   }
// }

// export async function createIntent(
//   contract: any,
//   addr: string,
//   config: {
//     user: string;
//     orderId: string;

//     originChainId: bigint;
//     destinationChainId: bigint;

//     maxSpent_token: string;
//     maxSpent_amount: bigint;
//     maxSpent_recipient: string;
//     maxSpent_chainId: bigint;

//     minReceived_token: string;
//     minReceived_amount: bigint;
//     minReceived_recipient: string;
//     minReceived_chainId: bigint;

//     originData: {
//       targetWallet: string;
//     };
//   },
// ) {
//   try {
//     return await erc7683.createIntent(contract, addr, config);
//   } catch (error) {
//     console.error(1, { error });
//     throw error;
//   }
// }

export async function callWerewolfMethod(
  contract: any,
  method: midnightContract.WerewolfMethodName,
  args: midnightContract.WerewolfMethodArgValue[],
) {
  try {
    return await midnightContract.callWerewolfMethod(contract, method, args);
  } catch (error) {
    console.error(1, { error });
    throw error;
  }
}

// export async function m20_transferFrom(
//   contract: any,
//   fromAccount: string,
//   toAccount: string,
//   amount: bigint,
// ) {
//   try {
//     return await unshielded_erc20.transferFrom(
//       contract,
//       fromAccount,
//       toAccount,
//       amount,
//     );
//   } catch (error) {
//     console.error(1, { error });
//     throw error;
//   }
// }
