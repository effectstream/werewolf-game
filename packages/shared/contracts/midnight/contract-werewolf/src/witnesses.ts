import { type WitnessContext } from "@midnight-ntwrk/compact-runtime";
import nacl from "tweetnacl";

// --- ENCRYPTION LOGIC ---

const ENCRYPTION_LIMITS = {
  NUM_MAX: 99,
  RND_MAX: 99,
  RAND_MAX: 999,
};

function packData(number: number, round: number, random: number): Uint8Array {
  if (
    number > ENCRYPTION_LIMITS.NUM_MAX || round > ENCRYPTION_LIMITS.RND_MAX ||
    random > ENCRYPTION_LIMITS.RAND_MAX
  ) {
    throw new Error("Overflow in packData");
  }
  const packed = (number << 17) | (round << 10) | random;
  const bytes = new Uint8Array(3);
  bytes[0] = (packed >> 16) & 0xFF;
  bytes[1] = (packed >> 8) & 0xFF;
  bytes[2] = packed & 0xFF;
  return bytes;
}

function deriveSessionKey(
  privKey: Uint8Array,
  pubKey: Uint8Array,
  roundNonce: number,
): Uint8Array {
  const sharedPoint = nacl.scalarMult(privKey, pubKey);
  const nonceBytes = new Uint8Array(new Int32Array([roundNonce]).buffer);
  const combined = new Uint8Array(sharedPoint.length + nonceBytes.length);
  combined.set(sharedPoint);
  combined.set(nonceBytes, sharedPoint.length);
  return nacl.hash(combined).slice(0, 3);
}

// STANDARD ENCRYPTION (Small Payload, Bytes<3>)
function encryptPayload(
  number: number,
  round: number,
  random: number,
  myPrivKey: Uint8Array, // STATIC Private Key
  receiverPubKey: Uint8Array,
  txNonce: number,
): Uint8Array {
  const payload = packData(number, round, random);

  // Derive session key using STATIC keys
  const sessionKey = deriveSessionKey(myPrivKey, receiverPubKey, txNonce);

  const ciphertext = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    ciphertext[i] = payload[i] ^ sessionKey[i];
  }

  return ciphertext;
}

// --- TYPES ---

export type Ledger = {};

export type MerkleTreeDigest = {
  field: bigint;
};

export type CoinPublicKey = {
  bytes: Uint8Array;
};

export type MerkleTreePathEntry = {
  sibling: MerkleTreeDigest;
  goes_left: boolean;
};

export type MerkleTreePath = {
  leaf: Uint8Array;
  path: MerkleTreePathEntry[];
};

export type SetupData = {
  roleCommitments: Uint8Array[];
  encryptedRoles: Uint8Array[];
  adminKey: CoinPublicKey;
  initialRoot: MerkleTreeDigest;
};

export type RawActionData = {
  targetNumber: number;
  random: number;
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array;
};

export type ContractActionData = {
  encryptedAction: Uint8Array;
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array;
};

export type PrivateState = {
  setupData: Map<string, SetupData>;
  encryptionKeypair?: { secretKey: Uint8Array; publicKey: Uint8Array };
  nextAction?: RawActionData;
};

export const witnesses = {
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
      return [privateState, new Uint8Array(32)];
    }

    return [privateState, data.roleCommitments[index]];
  },

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

    if (!data || !data.adminKey) {
      throw new Error(`Witness Error: Admin key missing for gameId ${key}`);
    }

    return [privateState, data.adminKey];
  },

  wit_getInitialRoot: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: number | bigint,
  ): [PrivateState, MerkleTreeDigest] => {
    const key = String(gameId);
    const data = privateState.setupData.get(key);

    if (!data || !data.initialRoot) {
      throw new Error(`Witness Error: Initial root missing for gameId ${key}`);
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
    const myKeys = privateState.encryptionKeypair; // This is now the STATIC keypair

    if (!setup || !action || !myKeys) {
      throw new Error(`Witness Error: Missing data for game ${key}`);
    }

    const roundNum = Number(round);

    // Use Standard Encryption
    const encryptedBytes = encryptPayload(
      action.targetNumber,
      roundNum,
      action.random,
      myKeys.secretKey, // Static Private Key
      setup.adminKey.bytes,
      roundNum, // Nonce
    );

    const contractData: ContractActionData = {
      encryptedAction: encryptedBytes, // Bytes<3>
      merklePath: action.merklePath,
      leafSecret: action.leafSecret,
    };

    return [privateState, contractData];
  },
};
