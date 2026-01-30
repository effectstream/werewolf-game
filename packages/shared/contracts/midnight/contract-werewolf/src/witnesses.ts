import { type WitnessContext } from "@midnight-ntwrk/compact-runtime";
import nacl from "tweetnacl";

// --- ENCRYPTION LOGIC (Ported from index.ts) ---

const ENCRYPTION_LIMITS = {
  NUM_MAX: 99, // 7 bits
  RND_MAX: 99, // 7 bits
  RAND_MAX: 999, // 10 bits
};

function packData(number: number, round: number, random: number): Uint8Array {
  if (
    number > ENCRYPTION_LIMITS.NUM_MAX || round > ENCRYPTION_LIMITS.RND_MAX ||
    random > ENCRYPTION_LIMITS.RAND_MAX
  ) {
    throw new Error("Overflow in packData");
  }
  // Layout: [Number (I~7b)] [Round (7b)] [Random (10b)] = 24 bits
  const packed = (number << 17) | (round << 10) | random;

  // Convert integer to 3-byte Uint8Array
  const bytes = new Uint8Array(3);
  bytes[0] = (packed >> 16) & 0xFF;
  bytes[1] = (packed >> 8) & 0xFF;
  bytes[2] = packed & 0xFF;
  return bytes;
}

function deriveSessionKey(
  myPrivKey: Uint8Array,
  theirPubKey: Uint8Array,
  txNonce: number,
): Uint8Array {
  // A. ECDH: Calculate Shared Secret Point (Standard X25519)
  const sharedPoint = nacl.scalarMult(myPrivKey, theirPubKey);

  // B. Context Mixing: Append the Transaction Nonce/Sequence ID
  const nonceBytes = new Uint8Array(new Int32Array([txNonce]).buffer);

  // C. Hash them together to get the symmetric key
  const combined = new Uint8Array(sharedPoint.length + nonceBytes.length);
  combined.set(sharedPoint);
  combined.set(nonceBytes, sharedPoint.length);

  return nacl.hash(combined).slice(0, 3); // We only need 3 bytes
}

function encryptPayload(
  number: number,
  round: number,
  random: number,
  myPrivKey: Uint8Array,
  receiverPubKey: Uint8Array,
  txNonce: number,
): Uint8Array {
  const payload = packData(number, round, random);
  const key = deriveSessionKey(myPrivKey, receiverPubKey, txNonce);

  // XOR Encryption
  const ciphertext = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    ciphertext[i] = payload[i] ^ key[i];
  }
  return ciphertext;
}

// --- TYPES ---

export type Ledger = {};

// Represents the MerkleTreeDigest struct in Compact
export type MerkleTreeDigest = {
  field: bigint;
};

export type CoinPublicKey = {
  bytes: Uint8Array;
};

// Represents the MerkleTreePathEntry struct in Compact
export type MerkleTreePathEntry = {
  sibling: MerkleTreeDigest;
  goes_left: boolean;
};

// Represents the MerkleTreePath<10, Bytes<32>> struct in Compact
export type MerkleTreePath = {
  leaf: Uint8Array;
  path: MerkleTreePathEntry[];
};

export type SetupData = {
  roleCommitments: Uint8Array[]; // Vector<16, Bytes<32>>
  // NEW: Pre-calculated encrypted roles for the players (Bytes<3>)
  // Admin calculates these off-chain: encrypt(Role, 0, Salt, AdminPriv, PlayerPub)
  encryptedRoles: Uint8Array[];
  adminKey: CoinPublicKey;
  initialRoot: MerkleTreeDigest;
};

// Raw action data stored in PrivateState before encryption
export type RawActionData = {
  targetNumber: number; // The player index being voted for
  random: number; // Random salt (0-999)
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array;
};

// The output expected by the circuit (Bytes<3>)
export type ContractActionData = {
  encryptedAction: Uint8Array; // Bytes<3>
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array;
};

export type PrivateState = {
  // Map of GameID (string representation of Uint<32>) -> SetupData
  setupData: Map<string, SetupData>;
  // Keypair for encryption (X25519) - Required for Client Witnesses
  encryptionKeypair?: { secretKey: Uint8Array; publicKey: Uint8Array };
  // The raw action planned for the next call
  nextAction?: RawActionData;
};

export const witnesses = {
  // 1. Fetch Commitment (Hash) - Unchanged
  wit_getRoleCommitment: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: number | bigint,
    n: number | bigint,
  ): [PrivateState, Uint8Array] => {
    const key = String(gameId);
    const data = privateState.setupData.get(key);

    if (!data) {
      throw new Error(`Witness Error: No setup data found for gameId ${key}`);
    }

    const index = Number(n);
    if (index < 0 || index >= data.roleCommitments.length) {
      return [privateState, new Uint8Array(32)]; // Default empty hash
    }

    return [privateState, data.roleCommitments[index]];
  },

  // 2. NEW: Fetch Encrypted Role (Bytes<3>)
  wit_getEncryptedRole: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: number | bigint,
    n: number | bigint,
  ): [PrivateState, Uint8Array] => {
    const key = String(gameId);
    const data = privateState.setupData.get(key);

    if (!data) {
      throw new Error(`Witness Error: No setup data found for gameId ${key}`);
    }

    const index = Number(n);
    // Return empty 3-byte array if out of bounds or missing
    if (
      !data.encryptedRoles || index < 0 || index >= data.encryptedRoles.length
    ) {
      return [privateState, new Uint8Array(3)];
    }

    return [privateState, data.encryptedRoles[index]];
  },

  wit_getAdminKey: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: number | bigint,
  ): [PrivateState, CoinPublicKey] => {
    const key = String(gameId);
    const data = privateState.setupData.get(key);

    if (!data) {
      throw new Error(`Witness Error: No setup data found for gameId ${key}`);
    }
    if (!data.adminKey || data.adminKey.bytes.length !== 32) {
      throw new Error(
        `Witness Error: Admin key missing or invalid for gameId ${key}`,
      );
    }

    return [privateState, data.adminKey];
  },

  wit_getInitialRoot: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: number | bigint,
  ): [PrivateState, MerkleTreeDigest] => {
    const key = String(gameId);
    const data = privateState.setupData.get(key);

    if (!data) {
      throw new Error(`Witness Error: No setup data found for gameId ${key}`);
    }
    if (!data.initialRoot || typeof data.initialRoot.field !== "bigint") {
      throw new Error(
        `Witness Error: Initial root missing or invalid for gameId ${key}`,
      );
    }

    return [privateState, data.initialRoot];
  },

  wit_getActionData: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: number | bigint,
    round: number | bigint,
  ): [PrivateState, ContractActionData] => {
    const key = String(gameId);
    const setup = privateState.setupData.get(key);
    const action = privateState.nextAction;
    const myKeys = privateState.encryptionKeypair;

    if (!setup) {
      throw new Error(`Witness Error: Setup data missing for game ${key}`);
    }
    if (!action) {
      throw new Error(
        `Witness Error: No action data staged in PrivateState for game ${key}`,
      );
    }
    if (!myKeys) {
      throw new Error(
        `Witness Error: No encryption keypair found in PrivateState`,
      );
    }

    const roundNum = Number(round);

    // Perform Encryption (Client Side)
    // We use the current round number as the 'nonce' for the session key derivation
    const encryptedBytes = encryptPayload(
      action.targetNumber,
      roundNum,
      action.random,
      myKeys.secretKey, // My Private Key
      setup.adminKey.bytes, // Receiver is Admin (Trusted Node)
      roundNum, // Nonce
    );

    // Validate structure basics
    if (encryptedBytes.length !== 3) {
      throw new Error(
        `Witness Error: Encrypted action must be 3 bytes, got ${encryptedBytes.length}`,
      );
    }
    if (action.leafSecret.length !== 32) {
      throw new Error(
        `Witness Error: Leaf secret must be 32 bytes, got ${action.leafSecret.length}`,
      );
    }

    // Construct return object for Contract
    const contractData: ContractActionData = {
      encryptedAction: encryptedBytes, // Now 3 bytes
      merklePath: action.merklePath,
      leafSecret: action.leafSecret,
    };

    return [privateState, contractData];
  },
};
