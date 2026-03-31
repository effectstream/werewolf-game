/**
 * Player and crypto/types used only by Player for the werewolf simulation.
 * This file does not import from the simulation main file.
 */
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";

// =============================================================================
// CONSTANTS & TYPES
// =============================================================================

export const Role = { Villager: 0, Werewolf: 1, Seer: 2, Doctor: 3 };

export type MerkleTreeDigest = { field: bigint };
export type MerkleTreePathEntry = {
  sibling: MerkleTreeDigest;
  goes_left: boolean;
};
export type MerkleTreePath = {
  leaf: Uint8Array;
  path: MerkleTreePathEntry[];
};

export type ActionData = {
  encryptedAction: Uint8Array;
  merklePath: MerkleTreePath;
  leafSecret: Uint8Array;
};

/** One actor's witness implementation (TrustedNode or Player). Shared so simulation only coordinates. */
export type WitnessSet<PS = Record<string, unknown>, L = unknown> = {
  wit_getRoleCommitment: (
    ctx: WitnessContext<L, PS>,
    gid: unknown,
    n: unknown,
  ) => [PS, Uint8Array];
  wit_getEncryptedRole: (
    ctx: WitnessContext<L, PS>,
    gid: unknown,
    n: unknown,
  ) => [PS, Uint8Array];
  wit_getInitialRoot: (
    ctx: WitnessContext<L, PS>,
    gid: unknown,
  ) => [PS, { field: bigint }];
  wit_getActionData: (
    ctx: WitnessContext<L, PS>,
    gid: unknown,
    round: bigint,
  ) => [PS, ActionData];
  wit_getAdminSecret: (
    ctx: WitnessContext<L, PS>,
    gid: unknown,
  ) => [PS, Uint8Array];
};

const ENCRYPTION_LIMITS = {
  NUM_MAX: 99,
  RND_MAX: 99,
  RAND_MAX: 999,
};

// =============================================================================
// CRYPTO (used only by Player for vote encryption)
// =============================================================================
function unpackData(
  bytes: Uint8Array,
): { target: number; round: number; random: number } {
  const packed = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  const target = (packed >> 17) & 0x7f;
  const round = (packed >> 10) & 0x7f;
  const random = packed & 0x3ff;
  return { target, round, random };
}

function packData(number: number, round: number, random: number): Uint8Array {
  if (
    number > ENCRYPTION_LIMITS.NUM_MAX ||
    round > ENCRYPTION_LIMITS.RND_MAX ||
    random > ENCRYPTION_LIMITS.RAND_MAX
  ) {
    throw new Error("Overflow in packData");
  }
  const packed = (number << 17) | (round << 10) | random;
  const bytes = new Uint8Array(3);
  bytes[0] = (packed >> 16) & 0xff;
  bytes[1] = (packed >> 8) & 0xff;
  bytes[2] = packed & 0xff;
  return bytes;
}

function deriveSessionKey(
  myPrivKey: Uint8Array,
  theirPubKey: Uint8Array,
  txNonce: number,
): Uint8Array {
  const sharedPoint = nacl.scalarMult(myPrivKey, theirPubKey);
  const nonceBytes = new Uint8Array(new Int32Array([txNonce]).buffer);
  const combined = new Uint8Array(sharedPoint.length + nonceBytes.length);
  combined.set(sharedPoint);
  combined.set(nonceBytes, sharedPoint.length);
  return nacl.hash(combined).slice(0, 3);
}

function xorPayload(payload: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(3);
  for (let i = 0; i < 3; i++) {
    result[i] = payload[i] ^ key[i];
  }
  return result;
}

// =============================================================================
// PLAYER
// =============================================================================

export class Player {
  readonly id: number;
  readonly leafSecret: Uint8Array;
  readonly encKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };

  leafHash?: Uint8Array;
  merklePath?: MerkleTreePath;

  role: number = Role.Villager;
  adminEncKey?: Uint8Array;
  isAlive: boolean = true;

  knownAlivePlayers: number[] = [];


  constructor(id: number) {
    this.id = id;
    this.leafSecret = new Uint8Array(
      createHash("sha256").update(`p${id}_${Math.random()}`).digest(),
    );
    this.encKeypair = nacl.box.keyPair();
  }

  async preGameSetup(
    computeHash: (secret: Uint8Array) => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    this.leafHash = await computeHash(this.leafSecret);
    return this.leafHash;
  }

  receiveGameConfig(
    role: number,
    adminEncKey: Uint8Array,
    totalPlayers: number,
  ): void {
    this.role = role;
    this.adminEncKey = adminEncKey;
    this.knownAlivePlayers = Array.from({ length: totalPlayers }, (_, i) => i);
  }

  getActionData(round: bigint): ActionData {
    if (!this.adminEncKey) {
      throw new Error(`P${this.id}: No Admin Encryption Key`);
    }
    if (!this.merklePath) throw new Error(`P${this.id}: No Merkle Path`);

    const targetIdx = this.chooseTarget();
    const random = Math.floor(Math.random() * 1000);

    const payload = packData(targetIdx, Number(round), random);
    const sessionKey = deriveSessionKey(
      this.encKeypair.secretKey,
      this.adminEncKey,
      Number(round),
    );
    const encryptedBuffer = xorPayload(payload, sessionKey);

    console.log(`${this.role}    P${this.id} votes for P${targetIdx}`);

    return {
      encryptedAction: encryptedBuffer,
      merklePath: this.merklePath,
      leafSecret: this.leafSecret,
    };
  }

  private chooseTarget(): number {
    const validTargets = this.knownAlivePlayers.filter((id) => id !== this.id);
    if (validTargets.length === 0) return this.id;
    return validTargets[Math.floor(Math.random() * validTargets.length)];
  }

  updateAliveStatus(deadId: number): void {
    this.knownAlivePlayers = this.knownAlivePlayers.filter(
      (id) => id !== deadId,
    );
  }

  /** Returns this player's witness set (action data only; setup witnesses throw). */
  getWitness<PS, L>(): WitnessSet<PS, L> {
    const p = this;
    return {
      wit_getRoleCommitment() {
        throw new Error("Player does not provide role commitment witness");
      },
      wit_getEncryptedRole() {
        throw new Error("Player does not provide encrypted role witness");
      },
      wit_getInitialRoot() {
        throw new Error("Player does not provide initial root witness");
      },
      wit_getActionData(ctx, _gid, round) {
        return [ctx.privateState, p.getActionData(round)];
      },
      wit_getAdminSecret() {
        throw new Error("Player does not provide admin secret witness");
      },
    };
  }
}
