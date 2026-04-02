import { contractAddressesEvmMain } from "@werewolf-game/evm-contracts";
import * as ContractContract from "@example-midnight/my-midnight-contract/contract";
import {
  convertMidnightLedger,
  normalizeMidnightLedgerStateInput,
} from "../../utils/paima-utils.ts";
import { getConnection } from "@paimaexample/db";
import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
} from "@paimaexample/config";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import {
  PrimitiveTypeEVMPaimaL2,
  PrimitiveTypeMidnightGeneric,
} from "@paimaexample/sm/builtin";
import { arbitrum } from "viem/chains";
import { paimaL2Grammar } from "@werewolf-game/data-types/grammar";

/**
 * Let check if the db.
 * If empty then the db is not initialized, and use the current time for the NTP sync.
 * If not, we recreate the original state configuration.
 */

const mainSyncProtocolName = "mainNtp";
let launchStartTime: number | undefined;

// Start syncing from the current chain tips, or from a specific block if configured.
// Set EVM_SYNC_FROM or MIDNIGHT_SYNC_FROM environment variables to override.
let arbOneTip: number = 0;
let midnightTip: number = 1;

const arbitrumOneRpc = Deno
  ? Deno.env.get("ARBITRUM_ONE_RPC")
  : undefined;

type ContractAddressBook = Record<string, Record<string, `0x${string}`>>;
const contractAddressBook = contractAddressesEvmMain() as ContractAddressBook;
const paimaL2MainnetContractAddress =
  contractAddressBook["chain42161"]?.["PaimaL2ContractModule#MyPaimaL2Contract"] ||
  "0x0000000000000000000000000000000000000000";

const midnightNetworkInputsValid = Boolean(
  midnightNetworkConfig.indexer &&
    midnightNetworkConfig.indexerWS &&
    midnightNetworkConfig.node,
);

let midnightContractAddress: string | undefined;
let midnightArtifactsReady = false;

if (Deno) {
  if (midnightNetworkInputsValid) {
    try {
      const counterContract = readMidnightContract(
        "contract-werewolf",
        { networkId: midnightNetworkConfig.id },
      );
      midnightContractAddress = counterContract.contractAddress;
      midnightArtifactsReady = Boolean(midnightContractAddress);
    } catch (error) {
      console.warn(
        `[midnight] Failed to read contract artifacts: ${
          (error as Error).message
        }`,
      );
      midnightArtifactsReady = false;
    }
  }

  // Read EVM_SYNC_FROM environment variable for custom EVM sync start block.
  // If set, sync from this block number. Otherwise, fetch current tip.
  const evmSyncFromEnv = Deno.env.get("EVM_SYNC_FROM");
  if (evmSyncFromEnv !== undefined && evmSyncFromEnv !== "") {
    const parsedBlock = parseInt(evmSyncFromEnv, 10);
    if (!isNaN(parsedBlock) && parsedBlock >= 0) {
      arbOneTip = parsedBlock;
      console.log(`[config] EVM sync from block (env var): ${arbOneTip}`);
    } else {
      console.warn(`[config] Invalid EVM_SYNC_FROM value: "${evmSyncFromEnv}", fetching tip instead`);
    }
  }

  // Fetch current Arbitrum One tip if EVM_SYNC_FROM is not set.
  if (arbOneTip === 0) {
    try {
      const rpcUrl = Deno.env.get("ARBITRUM_ONE_RPC") ?? "";
      if (rpcUrl) {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
        });
        const data = await res.json();
        if (data?.result) {
          arbOneTip = parseInt(data.result, 16);
          console.log(`[config] Arb One tip: ${arbOneTip}`);
        }
      }
    } catch (e) {
      console.warn("[config] Could not fetch Arb One tip, starting from 0:", e);
    }
  }

  // Read MIDNIGHT_SYNC_FROM environment variable for custom Midnight sync start block.
  // If set, sync from this block number. Otherwise, fetch current tip.
  const midnightSyncFromEnv = Deno.env.get("MIDNIGHT_SYNC_FROM");
  if (midnightSyncFromEnv !== undefined && midnightSyncFromEnv !== "") {
    const parsedBlock = parseInt(midnightSyncFromEnv, 10);
    if (!isNaN(parsedBlock) && parsedBlock >= 0) {
      midnightTip = parsedBlock;
      console.log(`[config] Midnight sync from block (env var): ${midnightTip}`);
    } else {
      console.warn(`[config] Invalid MIDNIGHT_SYNC_FROM value: "${midnightSyncFromEnv}", fetching tip instead`);
    }
  }

  // Fetch current Midnight mainnet tip if MIDNIGHT_SYNC_FROM is not set.
  if (midnightTip === 1) {
    try {
      const res = await fetch("https://rpc.mainnet.midnight.network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "chain_getBlock", params: [], id: 1 }),
      });
      const data = await res.json();
      const blockNumber = data?.result?.block?.header?.number;
      if (blockNumber != null) {
        midnightTip = parseInt(blockNumber, 16);
        console.log(`[config] Midnight mainnet tip: ${midnightTip}`);
      }
    } catch (e) {
      console.warn("[config] Could not fetch Midnight tip, starting from 1:", e);
    }
  }

  const dbConn = getConnection();
  try {
    const result = await dbConn.query(`
      SELECT * FROM effectstream.sync_protocol_pagination
      WHERE protocol_name = '${mainSyncProtocolName}'
      ORDER BY page_number ASC
      LIMIT 1
    `);
    if (result && result.rows.length > 0) {
      launchStartTime = result.rows[0].page.root -
        (result.rows[0].page_number * 1000);
    }
  } catch {
    // DB has not been initialized yet.
  }
}

export const config = new ConfigBuilder()
  .setNamespace(
    (builder: any) => builder.setSecurityNamespace("evm-midnight-node"),
  )
  .buildNetworks((builder: any) => {
    let networksBuilder = builder
      .addNetwork({
        name: "ntp",
        type: ConfigNetworkType.NTP,
        startTime: launchStartTime ?? new Date().getTime(),
        blockTimeMS: 1000,
      })
      .addViemNetwork({
        ...arbitrum,
        rpcUrls: {
          default: {
            // @ts-ignore: viem chains expect at least one compile-time RPC URL
            http: [arbitrumOneRpc ?? ""],
          },
        },
        name: "evmParallel_fast",
      });

    if (midnightNetworkInputsValid) {
      networksBuilder = networksBuilder.addNetwork({
        name: "midnight",
        type: ConfigNetworkType.MIDNIGHT,
        networkId: midnightNetworkConfig.id,
        nodeUrl: midnightNetworkConfig.node,
      });
    }

    return networksBuilder;
  })
  .buildDeployments((builder: any) => builder)
  .buildSyncProtocols((builder: any) => {
    let syncBuilder = builder
      .addMain(
        (networks: any) => networks.ntp,
        () => ({
          name: mainSyncProtocolName,
          type: ConfigSyncProtocolType.NTP_MAIN,
          chainUri: "",
          startBlockHeight: 1,
          pollingInterval: 500,
        }),
      )
      .addParallel(
        (networks: any) => networks.evmParallel_fast,
        (network: any) => ({
          name: "parallelEvmRPC_fast",
          type: ConfigSyncProtocolType.EVM_RPC_PARALLEL,
          chainUri: network.rpcUrls.default.http[0],
          startBlockHeight: arbOneTip,
          pollingInterval: 1000,
          stepSize: 20,
          confirmationDepth: 1,
        }),
      );

    if (midnightNetworkInputsValid) {
      syncBuilder = (syncBuilder as any).addParallel(
        (networks: any) => (networks as any).midnight,
        () => ({
          name: "parallelMidnight",
          type: ConfigSyncProtocolType.MIDNIGHT_PARALLEL,
          startBlockHeight: midnightTip ?? 1,
          pollingInterval: 2000,
          delayMs: 6000,
          indexer: midnightNetworkConfig.indexer,
          indexerWs: midnightNetworkConfig.indexerWS,
        }),
      );
    }

    return syncBuilder;
  })
  .buildPrimitives((builder: any) => {
    let primitivesBuilder = builder
      .addPrimitive(
        (syncProtocols: any) => syncProtocols.parallelEvmRPC_fast,
        () => ({
          name: "PaimaGameInteraction",
          type: PrimitiveTypeEVMPaimaL2,
          startBlockHeight: 0,
          contractAddress: paimaL2MainnetContractAddress,
          paimaL2Grammar: paimaL2Grammar,
        }),
      );

    if (midnightArtifactsReady) {
      primitivesBuilder = primitivesBuilder
        .addPrimitive(
          (syncProtocols: any) => (syncProtocols as any).parallelMidnight,
          () => ({
            name: "MidnightContractState",
            type: PrimitiveTypeMidnightGeneric,
            startBlockHeight: 1,
            contractAddress: midnightContractAddress!,
            stateMachinePrefix: "midnightContractState",
            contract: {
              ledger: (data: any) => {
                const result = ContractContract.ledger(
                  normalizeMidnightLedgerStateInput(data),
                );
                return convertMidnightLedger(result);
              },
            },
            networkId: midnightNetworkConfig.id,
          }),
        );
    }

    return primitivesBuilder;
  })
  .build();
