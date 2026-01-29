import { type WitnessContext } from "@midnight-ntwrk/compact-runtime";
import { Buffer } from "node:buffer";

export type Ledger = {};

// Represents the MerkleTreeDigest struct in Compact
export type MerkleTreeDigest = {
  field: bigint;
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

// Corresponds to SetupData struct in WerewolfTypes.compact
export type SetupData = {
  roleCommitments: Uint8Array[]; // Vector<10, Bytes<32>>
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
  wit_getSetupData: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    gameId: Uint8Array,
  ): [PrivateState, SetupData] => {
    const key = toHex(gameId);
    const data = privateState.setupData.get(key);

    if (!data) {
      throw new Error(`Witness Error: No setup data found for gameId ${key}`);
    }

    if (data.roleCommitments.length !== 10) {
      throw new Error(
        `Witness Error: SetupData must contain exactly 10 commitments, found ${data.roleCommitments.length}`,
      );
    }

    return [privateState, data];
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
