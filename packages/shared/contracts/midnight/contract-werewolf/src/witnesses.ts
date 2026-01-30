import { type WitnessContext } from "@midnight-ntwrk/compact-runtime";
import { Buffer } from "node:buffer";
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
  goes_left: boolean; // Changed from goesLeft to goes_left
};
// Represents the MerkleTreePath<10, Bytes<32>> struct in Compact
export type MerkleTreePath = {
  leaf: Uint8Array;
  path: MerkleTreePathEntry[];
};
// SetupData struct is removed, but we still use the underlying array type for our local private state
export type SetupData = {
  roleCommitments: Uint8Array[]; // Vector<10, Bytes<32>>
  adminKey: CoinPublicKey;
  initialRoot: MerkleTreeDigest;
};
// Corresponds to ActionData struct in WerewolfTypes.compact
export type ActionData = {
  encryptedAction: Uint8Array; // Bytes<129>
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array; // Bytes<32>
};
export type PrivateState = {
  // Map of GameID (hex string) -> SetupData
  setupData: Map<string, SetupData>;
  // The action data intended for the current transaction call.
  nextAction?: ActionData;
};
// Helper to convert Uint8Array to Hex String for Map lookups
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
export const witnesses = {
  // Replaces wit_getSetupData with granular access
  wit_getRoleCommitment: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: Uint8Array,
    n: number | bigint,
  ): [PrivateState, Uint8Array] => {
    const key = toHex(gameId);
    const data = privateState.setupData.get(key);

    if (!data) {
      throw new Error(`Witness Error: No setup data found for gameId ${key}`);
    }

    const index = Number(n);
    if (index < 0 || index >= data.roleCommitments.length) {
      return [privateState, new Uint8Array(0)];
    }

    return [privateState, data.roleCommitments[index]];
  },
  wit_getAdminKey: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: Uint8Array,
  ): [PrivateState, CoinPublicKey] => {
    const key = toHex(gameId);
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
    gameId: Uint8Array,
  ): [PrivateState, MerkleTreeDigest] => {
    const key = toHex(gameId);
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
    gameId: Uint8Array,
    round: number | bigint,
  ): [PrivateState, ActionData] => {
    if (!privateState.nextAction) {
      const key = toHex(gameId);
      throw new Error(
        `Witness Error: No action data staged in PrivateState for game ${key}`,
      );
    }

    const action = privateState.nextAction;

    // Validate structure basics
    if (action.encryptedAction.length !== 129) {
      throw new Error(
        `Witness Error: Encrypted action must be 129 bytes, got ${action.encryptedAction.length}`,
      );
    }
    if (action.leafSecret.length !== 32) {
      throw new Error(
        `Witness Error: Leaf secret must be 32 bytes, got ${action.leafSecret.length}`,
      );
    }

    return [privateState, action];
  },
};
