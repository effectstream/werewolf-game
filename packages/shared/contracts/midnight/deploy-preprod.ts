/**
 * Deploy Werewolf Contract to Midnight preprod network.
 *
 * Usage:
 *   deno task midnight-contract:deploy:preprod           # deploy contract
 *   deno task midnight-contract:deploy:preprod --wallet  # print wallet addresses and exit
 *
 * This script:
 *   1. Loads .env.preprod from the repo root
 *   2. Spawns the Midnight proof server configured for preprod (TestNet ledger)
 *   3. Waits for the proof server to be ready on :6300
 *   4. Deploys the Werewolf contract to the preprod network
 *
 * Dust generation:
 *   If the wallet has no dust but has NIGHT (unshielded) balance, the deployment
 *   script automatically calls registerNightForDust() via ensureDustBalance() in
 *   deploy-ledger7.ts before proceeding with the deployment.
 */

import { loadSync } from "@std/dotenv";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  buildDeployWalletFacade,
  type DeployConfig,
  deployMidnightContract,
  type NetworkUrls,
} from "./deploy-ledger7.ts";
import {
  deriveSeedForRole,
  registerNightForDust,
  syncAndWaitForFunds,
  waitForDustFunds,
  type WalletResult as FaucetWalletResult,
} from "./faucet.ts";
import {
  Contract,
  type PrivateState,
  witnesses,
} from "./contract-werewolf/src/_index.ts";
import { Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { ZswapSecretKeys } from "@midnight-ntwrk/ledger-v7";
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import type { NetworkId } from "@midnight-ntwrk/wallet-sdk-abstractions";

// Declare Deno global for type-checking when not executed under Deno tooling.
declare const Deno: typeof globalThis.Deno;

// ============================================================================
// Load .env.preprod
// ============================================================================

const SCRIPT_DIR = dirname(fromFileUrl(import.meta.url));
const ENV_PATH = join(SCRIPT_DIR, "../../../../.env.preprod");

// loadSync sets env vars in process before any async code runs
const loadedEnv = loadSync({ envPath: ENV_PATH, export: true });

// ============================================================================
// Preprod network config
// ============================================================================

const NETWORK_ID = "preprod" as NetworkId.NetworkId;

// URLs: prefer explicit overrides from .env.preprod, then auto-derive from network ID
const PREPROD_URLS: NetworkUrls = {
  id: NETWORK_ID,
  indexer: Deno.env.get("MIDNIGHT_INDEXER_HTTP") ??
    Deno.env.get("MIDNIGHT_INDEXER_URL") ??
    `https://indexer.${NETWORK_ID}.midnight.network/api/v3/graphql`,
  indexerWS: Deno.env.get("MIDNIGHT_INDEXER_WS") ??
    Deno.env.get("MIDNIGHT_INDEXER_WS_URL") ??
    `wss://indexer.${NETWORK_ID}.midnight.network/api/v3/graphql/ws`,
  node: Deno.env.get("MIDNIGHT_NODE_HTTP") ??
    Deno.env.get("MIDNIGHT_NODE_URL") ??
    `https://rpc.${NETWORK_ID}.midnight.network`,
  proofServer: Deno.env.get("MIDNIGHT_PROOF_SERVER_URL") ??
    "http://127.0.0.1:6300",
  // Pass seed explicitly so deploy-ledger7 doesn't need it from midnightNetworkConfig
  walletSeed: Deno.env.get("MIDNIGHT_WALLET_SEED") ??
    loadedEnv["MIDNIGHT_WALLET_SEED"],
};

// ============================================================================
// Proof server
// ============================================================================

function startProofServer(): Deno.ChildProcess {
  console.log(
    "[proof-server] Starting Midnight proof server for preprod (TestNet ledger)...",
  );

  const nodeWsUrl = Deno.env.get("SUBSTRATE_NODE_WS_URL") ??
    "wss://rpc.preprod.midnight.network";

  const command = new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "--unstable-detect-cjs",
      "npm:@paimaexample/npm-midnight-proof-server",
    ],
    env: {
      ...Deno.env.toObject(),
      LEDGER_NETWORK_ID: "TestNet",
      RUST_BACKTRACE: "full",
      SUBSTRATE_NODE_WS_URL: nodeWsUrl,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  return command.spawn();
}

async function waitForProofServer(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  console.log("[proof-server] Waiting for proof server on :6300...");
  while (Date.now() < deadline) {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port: 6300 });
      conn.close();
      console.log("[proof-server] Proof server is ready.");
      return;
    } catch {
      // not ready yet — wait a bit
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `Proof server did not become ready within ${timeoutMs / 1000}s`,
  );
}

// ============================================================================
// --wallet flag: print addresses derived from the seed
// ============================================================================

async function printWalletAddresses(seed: string): Promise<void> {
  const shieldedSeed = deriveSeedForRole(seed, Roles.Zswap);
  const unshieldedSeed = deriveSeedForRole(seed, Roles.NightExternal);

  // Shielded address — pure crypto, no network needed.
  // Encodes coin public key + encryption public key into the mn_addr_preprod1… Bech32m format,
  // matching exactly what Lace wallet displays.
  setNetworkId(NETWORK_ID);
  const zswapKeys = ZswapSecretKeys.fromSeed(shieldedSeed);
  const cpk = ShieldedCoinPublicKey.fromHexString(zswapKeys.coinPublicKey);
  const epk = ShieldedEncryptionPublicKey.fromHexString(
    zswapKeys.encryptionPublicKey,
  );
  const shieldedAddress = MidnightBech32m.encode(
    NETWORK_ID,
    new ShieldedAddress(cpk, epk),
  ).asString();

  // Unshielded address — pure crypto, no network needed.
  const unshieldedKeystore = createKeystore(unshieldedSeed, NETWORK_ID);
  const unshieldedAddress = unshieldedKeystore.getBech32Address().asString();

  // Dust address + balances — requires starting the WalletFacade to emit state.
  // buildDeployWalletFacade initialises all wallets and calls wallet.start().
  const walletResult = await buildDeployWalletFacade(
    {
      indexer: PREPROD_URLS.indexer!,
      indexerWS: PREPROD_URLS.indexerWS!,
      node: PREPROD_URLS.node!,
      proofServer: PREPROD_URLS.proofServer!,
    },
    seed,
    NETWORK_ID,
  );
  const dustAddress = walletResult.dustAddress;

  // Sync and read balances (waitNonZero:false returns as soon as sync completes,
  // even if all balances are 0).
  console.log("Syncing wallet to fetch balances...");
  let shieldedBalance = 0n;
  let unshieldedBalance = 0n;
  let dustBalance = 0n;
  try {
    ({ shieldedBalance, unshieldedBalance, dustBalance } =
      await syncAndWaitForFunds(walletResult.wallet, {
        waitNonZero: false,
        logLabel: "wallet-info",
      }));
  } catch (err) {
    console.warn(
      `Warning: could not fetch balances: ${(err as Error).message}`,
    );
  }

  // If we have unshielded NIGHT but no dust, register for dust generation.
  if (dustBalance === 0n && unshieldedBalance > 0n) {
    console.log(
      "\nUnshielded NIGHT found but no dust. Registering Night UTXOs for dust generation...",
    );
    try {
      const registered = await registerNightForDust(
        walletResult as unknown as FaucetWalletResult,
      );
      if (registered) {
        try {
          dustBalance = await waitForDustFunds(walletResult.wallet, {
            timeoutMs: 60_000,
          });
        } catch {
          // Balance still 0 — generation just started or TX pending confirmation.
        }
        if (dustBalance === 0n) {
          console.log(
            "Night UTXOs are registered for dust generation. Dust balance is 0 now — generation accumulates gradually over time.",
          );
        } else {
          console.log(`Dust balance: ${dustBalance}`);
        }
      } else {
        console.log(
          "Could not register for dust generation: no eligible Night UTXOs found.",
        );
      }
    } catch (err) {
      console.warn(
        `Warning: dust registration failed: ${(err as Error).message}`,
      );
    }
  }

  try {
    await walletResult.wallet.stop();
  } catch {
    // ignore stop errors
  }

  console.log("\n=== Wallet Info (preprod) ===");
  console.log(`Seed:               ${seed}`);
  console.log(`Shielded address:   ${shieldedAddress}`);
  console.log(`Unshielded address: ${unshieldedAddress}`);
  console.log(`Dust address:       ${dustAddress}`);
  console.log("--- Balances ---");
  console.log(`Shielded (NIGHT):   ${shieldedBalance}`);
  console.log(`Unshielded (NIGHT): ${unshieldedBalance}`);
  console.log(`Dust:               ${dustBalance}`);
  console.log("============================\n");
}

// ============================================================================
// Main
// ============================================================================

const seed = PREPROD_URLS.walletSeed ??
  Deno.env.get("MIDNIGHT_WALLET_SEED") ??
  loadedEnv["MIDNIGHT_WALLET_SEED"] ??
  "";

if (!seed) {
  console.error(
    "ERROR: MIDNIGHT_WALLET_SEED is not set. Add it to .env.preprod.",
  );
  Deno.exit(1);
}

const args = Deno.args;
const showWallet = args.includes("--wallet");

if (showWallet) {
  await printWalletAddresses(seed);
  Deno.exit(0);
}

// ── Deploy ────────────────────────────────────────────────────────────────────

const proofServerProcess = startProofServer();

// Give the binary a moment to initialise before we start polling
await new Promise((r) => setTimeout(r, 3_000));

try {
  await waitForProofServer();
} catch (err) {
  console.error("[proof-server] Failed to start:", (err as Error).message);
  proofServerProcess.kill("SIGTERM");
  Deno.exit(1);
}

const deployConfig: DeployConfig = {
  contractName: "contract-werewolf",
  contractFileName: "contract-werewolf.json",
  contractClass: Contract.Contract,
  witnesses,
  privateStateId: "privateState",
  initialPrivateState: {
    setupData: new Map(),
    adminSecrets: new Map(),
  } as PrivateState,
  privateStateStoreName: "werewolf-private-state",
};

try {
  const contractAddress = await deployMidnightContract(
    deployConfig,
    PREPROD_URLS,
  );
  console.log(`\nDeployment successful. Contract address: ${contractAddress}`);
} catch (err) {
  console.error("Deployment failed:", err);
  proofServerProcess.kill("SIGTERM");
  Deno.exit(1);
} finally {
  proofServerProcess.kill("SIGTERM");
}

Deno.exit(0);
