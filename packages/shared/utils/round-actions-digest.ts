import {
  Contract as WerewolfRuntimeContract,
  Phase,
  pureCircuits,
} from "../contracts/midnight/contract-werewolf/src/managed/contract/index.js";

// Internal runtime methods used by computeRoundActionsDigest.
// These suffixes are assigned by the Compact compiler and may change on
// recompilation — verify against managed/contract/index.js if tests break.
type RuntimeContractWithInternals = WerewolfRuntimeContract & {
  _persistentHash_5(value: bigint): Uint8Array; // Uint<32> → Bytes<32>
  _persistentHash_1(value: Uint8Array): Uint8Array; // Bytes<32> → Bytes<32>
  _hash2_0(a: Uint8Array, b: Uint8Array): Uint8Array; // [Bytes<32>,Bytes<32>] → Bytes<32>
};

export type RoundActionDigestInput = {
  nullifier: Uint8Array;
  encryptedAction: Uint8Array;
};

type PhaseLike = string | number;
type NormalizedPhase = 1 | 2;

const textEncoder = new TextEncoder();

function stubWitnessError(name: string): never {
  throw new Error(`Stub witness called unexpectedly: ${name}`);
}

function createRuntimeContract(): RuntimeContractWithInternals {
  const stubWitnesses = {
    wit_getRoleCommitment: () => stubWitnessError("wit_getRoleCommitment"),
    wit_getEncryptedRole: () => stubWitnessError("wit_getEncryptedRole"),
    wit_getInitialRoot: () => stubWitnessError("wit_getInitialRoot"),
    wit_getActionData: () => stubWitnessError("wit_getActionData"),
    wit_getAdminSecret: () => stubWitnessError("wit_getAdminSecret"),
  };

  return new WerewolfRuntimeContract(
    stubWitnesses,
  ) as RuntimeContractWithInternals;
}

const runtimeContract = createRuntimeContract();

function padLabel32(label: string): Uint8Array {
  const bytes = textEncoder.encode(label);
  const padded = new Uint8Array(32);
  padded.set(bytes.slice(0, 32));
  return padded;
}

function normalizeBytes(value: Uint8Array, expectedLength: number): Uint8Array {
  if (value.length === expectedLength) return new Uint8Array(value);
  if (value.length > expectedLength) return value.slice(0, expectedLength);

  const padded = new Uint8Array(expectedLength);
  padded.set(value);
  return padded;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function normalizePhase(phase: PhaseLike): NormalizedPhase {
  if (typeof phase === "number") {
    if (phase === Phase.Night) return Phase.Night as NormalizedPhase;
    if (phase === Phase.Day) return Phase.Day as NormalizedPhase;
  } else if (typeof phase === "string") {
    const raw = phase.toUpperCase();
    if (raw === "1" || raw === "NIGHT") return Phase.Night as NormalizedPhase;
    if (raw === "2" || raw === "DAY") return Phase.Day as NormalizedPhase;
  }

  throw new Error(`Unsupported phase for round digest: ${String(phase)}`);
}

function phaseDomainTag(phase: NormalizedPhase): Uint8Array {
  return phase === Phase.Night
    ? padLabel32("night-round-v1")
    : padLabel32("day-round-v1");
}

export function computeVoteNullifier(
  gameId: number | bigint,
  round: number | bigint,
  phase: PhaseLike,
  leafSecret: Uint8Array,
): Uint8Array {
  const gid = BigInt(gameId);
  const r = BigInt(round);
  const secret = normalizeBytes(leafSecret, 32);

  if (normalizePhase(phase) === Phase.Day) {
    return pureCircuits.testComputeNullifierDay(gid, r, secret);
  }

  return pureCircuits.testComputeNullifierNight(gid, r, secret);
}

export function computeRoundActionsDigest(
  gameId: number | bigint,
  round: number | bigint,
  phase: PhaseLike,
  actions: RoundActionDigestInput[],
): Uint8Array {
  const normalizedPhase = normalizePhase(phase);
  let digest = runtimeContract._hash2_0(
    phaseDomainTag(normalizedPhase),
    runtimeContract._persistentHash_5(BigInt(gameId)),
  );
  digest = runtimeContract._hash2_0(
    digest,
    runtimeContract._persistentHash_5(BigInt(round)),
  );

  const orderedActions = [...actions].sort((left, right) =>
    compareBytes(left.nullifier, right.nullifier)
  );

  for (const action of orderedActions) {
    const entryDigest = runtimeContract._hash2_0(
      normalizeBytes(action.nullifier, 32),
      runtimeContract._persistentHash_1(normalizeBytes(action.encryptedAction, 3)),
    );
    digest = runtimeContract._hash2_0(digest, entryDigest);
  }

  return digest;
}
