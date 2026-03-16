import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";

import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
} from "@paimaexample/config";
import { getConnection } from "@paimaexample/db";
import {
  PrimitiveTypeEVMPaimaL2,
  PrimitiveTypeMidnightGeneric,
} from "@paimaexample/sm/builtin";
import * as ContractContract from "@example-midnight/my-midnight-contract/contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import { hardhat } from "viem/chains";
import { convertMidnightLedger } from "../../utils/paima-utils.ts";
import { contractAddressesEvmMain } from "@werewolf-game/evm-contracts";
import { paimaL2Grammar } from "@werewolf-game/data-types/grammar";

/**
 * Let check if the db.
 * If empty then the db is not initialized, and use the current time for the NTP sync.
 * If not, we recreate the original state configuration.
 */

const mainSyncProtocolName = "mainNtp";
let launchStartTime: number | undefined;
const dbConn = getConnection();
try {
  const result = await dbConn.query(`
    SELECT * FROM effectstream.sync_protocol_pagination 
    WHERE protocol_name = '${mainSyncProtocolName}' 
    ORDER BY page_number ASC
    LIMIT 1
  `);
  if (!result || !result.rows.length) {
    throw new Error("DB is empty");
  }
  launchStartTime = result.rows[0].page.root -
    (result.rows[0].page_number * 1000);
} catch {
  // This is not an error.
  // Do nothing, the DB has not been initialized yet.
}

export const config = new ConfigBuilder()
  .setNamespace(
    (builder) => builder.setSecurityNamespace("evm-midnight-node"),
  )
  .buildNetworks((builder) =>
    builder
      .addNetwork({
        name: "ntp",
        type: ConfigNetworkType.NTP,
        // Initial time for the Paima Engine Node. Unix Timestamp in milliseconds.
        // Give 2 minutes to the server to start syncing.
        // In development mode local chains can take a while to start and deploy contracts.
        startTime: launchStartTime ?? new Date().getTime(),
        // Block size is milliseconds, this will be used to sync other chains.
        // Block times will be exact, and not affected by the network latency, or server time.
        blockTimeMS: 1000,
      })
      .addNetwork({
        name: "midnight",
        type: ConfigNetworkType.MIDNIGHT,
        networkId: midnightNetworkConfig.id,
        nodeUrl: midnightNetworkConfig.node,
      })
      .addViemNetwork({
        ...hardhat,
        name: "evmParallel_fast",
      })
  )
  .buildDeployments((builder) => builder).buildSyncProtocols((builder) =>
    builder
      .addMain(
        (networks) => networks.ntp,
        (network, deployments) => ({
          name: mainSyncProtocolName,
          type: ConfigSyncProtocolType.NTP_MAIN,
          chainUri: "",
          startBlockHeight: 1,
          pollingInterval: 1000,
        }),
      )
      .addParallel(
        (networks) => networks.midnight,
        (network, deployments) => ({
          name: "parallelMidnight",
          type: ConfigSyncProtocolType.MIDNIGHT_PARALLEL,
          startBlockHeight: 1,
          pollingInterval: 1000,
          indexer: midnightNetworkConfig.indexer,
          indexerWs: midnightNetworkConfig.indexerWS,
        }),
      )
      .addParallel(
        (networks) => (networks as any).evmParallel_fast,
        (network, deployments) => ({
          name: "parallelEvmRPC_fast",
          type: ConfigSyncProtocolType.EVM_RPC_PARALLEL,
          chainUri: network.rpcUrls.default.http[0],
          startBlockHeight: 1,
          pollingInterval: 500, // poll quickly to react fast
          confirmationDepth: 1, // TODO: test this
        }),
      )
  )
  .buildPrimitives((builder) =>
    builder
      .addPrimitive(
        (syncProtocols) => syncProtocols.parallelMidnight,
        (network, deployments, syncProtocol) => ({
          name: "MidnightContractState",
          type: PrimitiveTypeMidnightGeneric,
          startBlockHeight: 1,
          contractAddress: readMidnightContract(
            "contract-werewolf",
            { networkId: midnightNetworkConfig.id },
          ).contractAddress,
          stateMachinePrefix: "midnightContractState",
          contract: {
            ledger: (data: any) => {
              const result = ContractContract.ledger(data);
              return convertMidnightLedger(result);
            },
          },
          networkId: midnightNetworkConfig.id,
        }),
      )
      .addPrimitive(
        (syncProtocols) => (syncProtocols as any).parallelEvmRPC_fast,
        (network, deployments, syncProtocol) => ({
          name: "PaimaGameInteraction",
          type: PrimitiveTypeEVMPaimaL2,
          startBlockHeight: 0,
          contractAddress: contractAddressesEvmMain()["chain31337"][
            "PaimaL2ContractModule#MyPaimaL2Contract"
          ],
          paimaL2Grammar: paimaL2Grammar,
        }),
      )
  )
  .build();
