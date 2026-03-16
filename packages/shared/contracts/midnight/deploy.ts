/**
 * Deploy Werewolf Contract to Midnight Network
 *
 * This script deploys the Werewolf compact contract to the Midnight blockchain.
 *
 * Usage:
 *   deno task midnight-contract:deploy
 *
 * Prerequisites:
 *   1. Midnight node running     (deno task midnight-node:start)
 *   2. Midnight indexer running  (deno task midnight-indexer:start)
 *   3. Midnight proof server running (deno task midnight-proof-server:start)
 *   4. Contract compiled         (deno task contract:compile)
 *
 * Incremental deployment (to avoid "Transaction would exhaust block limits"):
 *   The Werewolf contract has many circuits and all their verifier keys may not
 *   fit in a single transaction. The deployment logic automatically retries with
 *   a single verifier key when a block-limit error is detected, then inserts the
 *   remaining keys one-by-one via separate transactions.
 *
 *   You can also control this behaviour explicitly via env vars:
 *
 *   MIDNIGHT_DEPLOY_VERIFIER_KEYS_LIMIT=1   — deploy with N verifier keys in the
 *                                             initial transaction (rest inserted separately)
 *   MIDNIGHT_DEPLOY_VERIFIER_KEY_IDS=createGame,nightAction
 *                                           — deploy only the named circuits first
 *   MIDNIGHT_DEPLOY_SKIP_INSERT_REMAINING_VKS=true
 *                                           — skip inserting remaining VKs (for testing)
 */

import { type DeployConfig, deployMidnightContract } from "./deploy-ledger7.ts";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import {
  Contract,
  type PrivateState,
  witnesses,
} from "./contract-werewolf/src/_index.ts";

const config: DeployConfig = {
  contractName: "contract-werewolf",
  contractFileName: "contract-werewolf.undeployed.json",
  contractClass: Contract.Contract,
  witnesses,
  privateStateId: "privateState",
  initialPrivateState: {
    setupData: new Map(),
  } as PrivateState,
  privateStateStoreName: "werewolf-private-state",
};

deployMidnightContract(config, midnightNetworkConfig)
  .then(() => {
    console.log("Werewolf contract deployment successful");
    Deno.exit(0);
  })
  .catch((e: unknown) => {
    console.error("Deployment failed:", e);
    Deno.exit(1);
  });
