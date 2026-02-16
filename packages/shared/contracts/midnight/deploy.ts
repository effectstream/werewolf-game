import {
  type DeployConfig,
  deployMidnightContract,
} from "@paimaexample/midnight-contracts/deploy";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import {
  Contract,
  type PrivateState,
  witnesses,
} from "./contract-werewolf/src/_index.ts";

const config: DeployConfig = {
  contractName: "contract-werewolf",
  contractFileName: "contract-werewolf.json",
  contractClass: Contract.Contract,
  witnesses,
  privateStateId: "privateState",
  initialPrivateState: {} as PrivateState,
  privateStateStoreName: "private-state",
};

console.log("Deploying contract with network config:", midnightNetworkConfig);

deployMidnightContract(config, midnightNetworkConfig)
  .then((address) => {
    console.log(`Deployment successful! Contract address: ${address}`);
    Deno.exit(0);
  })
  .catch((e: unknown) => {
    console.error("Deployment failed:", e);
    Deno.exit(1);
  });
