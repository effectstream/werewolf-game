// import { type DeployConfig, deployMidnightContract } from "./deploy-ledger6.ts";
import {
  type DeployConfig,
  deployMidnightContract,
} from "@paimaexample/midnight-contracts/deploy-ledger6";

import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import {
  Contract,
  type PrivateState,
  witnesses,
} from "./contract-werewolf/src/index.original.ts";

// import {
//   Contract,
//   type ContractPrivateState as PrivateState,
//   witnesses,
// } from "./contract-round-value/src/index.original.ts";

const config: DeployConfig = {
  contractName: "contract-werewolf",
  contractFileName: "contract-werewolf.undeployed.json",
  // contractName: "contract-round-value",
  // contractFileName: "contract-round-value.json",
  contractClass: Contract.Contract,
  witnesses,
  privateStateId: "privateState",
  initialPrivateState: {} as PrivateState,
  privateStateStoreName: "private-state",
};

deployMidnightContract(config, midnightNetworkConfig)
  .then(() => {
    console.log("Deployment successful");
    Deno.exit(0);
  })
  .catch((e: unknown) => {
    console.error("Unhandled error:", e);
    Deno.exit(1);
  });
