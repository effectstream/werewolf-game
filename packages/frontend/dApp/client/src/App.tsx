import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { loginMidnight } from "./interface.ts";
import { callWerewolfMethod, connectToContract } from "./contracts/contract.ts";
import { fromHex } from "@midnight-ntwrk/compact-runtime";
import {
  Contract as WerewolfRuntimeContract,
  pureCircuits,
} from "../../../../shared/contracts/midnight/contract-werewolf/src/managed/contract/index.js";
import { Buffer } from "node:buffer";
import { decrypt, encrypt, PrivateKey } from "eciesjs";

const MAX_PLAYERS = 10;

const Role = {
  Villager: 0,
  Werewolf: 1,
  Seer: 2,
  Doctor: 3,
};

const Phase = {
  Lobby: 0,
  Night: 1,
  Day: 2,
  Finished: 3,
};

type PlayerLocalState = {
  id: number;
  pk: Uint8Array;
  sk: Uint8Array;
  role: number;
  salt: Uint8Array;
  alive: boolean;
  commitment: Uint8Array;
  leaf: Uint8Array;
};

type PlayerBundle = {
  gameId: string;
  playerId: number;
  leafSecret: string;
  merklePath: { sibling: { field: string }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
};

type PlayerProfile = {
  gameId: Uint8Array;
  playerId: number;
  leafSecret: Uint8Array;
  merklePath: { sibling: { field: bigint }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
};

type GameState = {
  gameId: Uint8Array;
  masterSecret: Uint8Array;
  masterSecretCommitment: Uint8Array;
  adminVotePrivateKeyHex: string;
  adminVotePublicKeyHex: string;
  adminVotePublicKeyBytes: Uint8Array;
  players: PlayerLocalState[];
  tree: RuntimeMerkleTree;
  round: number;
  phase: number;
  playerCount: number;
  werewolfCount: number;
};

function stringifyWithBigInt(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v) => {
      if (typeof v === "bigint") {
        return v.toString();
      }
      if (v instanceof Uint8Array) {
        return `0x${toHexString(v)}`;
      }
      return v;
    },
    2,
  );
}

const toHexString = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const randomBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const randomBytes32 = () => randomBytes(32);

const hexToBytes = (hex: string): Uint8Array => {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${normalized.length}`);
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const start = i * 2;
    bytes[i] = Number.parseInt(normalized.slice(start, start + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array) => `0x${toHexString(bytes)}`;

const padBytes32 = (value: string) => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < Math.min(value.length, 32); i++) {
    bytes[i] = value.charCodeAt(i);
  }
  return bytes;
};

const roleName = (role: number) => {
  switch (role) {
    case Role.Villager:
      return "Villager";
    case Role.Werewolf:
      return "Werewolf";
    case Role.Seer:
      return "Seer";
    case Role.Doctor:
      return "Doctor";
    default:
      return `Unknown(${role})`;
  }
};

const phaseName = (phase: number) => {
  switch (phase) {
    case Phase.Lobby:
      return "Lobby";
    case Phase.Night:
      return "Night";
    case Phase.Day:
      return "Day";
    case Phase.Finished:
      return "Finished";
    default:
      return `Unknown(${phase})`;
  }
};

const encodeVoteTarget = (targetIdx: number): Uint8Array => {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, targetIdx, true);
  return bytes;
};

const decodeVoteTarget = (payload: Uint8Array): number => {
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  return view.getUint32(0, true);
};

const encryptPayload = (
  adminPublicKeyHex: string,
  payload: Uint8Array,
): Uint8Array => {
  const encrypted = encrypt(adminPublicKeyHex, payload);
  const bytes = encrypted instanceof Uint8Array
    ? encrypted
    : new Uint8Array(encrypted);
  if (bytes.length !== 129) {
    throw new Error(
      `Unexpected encrypted length ${bytes.length}, expected 129`,
    );
  }
  return bytes;
};

const isZeroBytes = (bytes: Uint8Array) => {
  for (const byte of bytes) {
    if (byte !== 0) return false;
  }
  return true;
};

const resolveVotes = (
  voteTargets: number[],
  players: PlayerLocalState[],
  isNight: boolean,
): { targetIdx: number; hasElimination: boolean; info: string } => {
  const counts = new Map<number, number>();
  for (const targetIdx of voteTargets) {
    const target = players.find((p) => p.id === targetIdx);
    if (!target || !target.alive) continue;
    counts.set(targetIdx, (counts.get(targetIdx) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return {
      targetIdx: 0,
      hasElimination: false,
      info: "No valid votes.",
    };
  }

  let maxVotes = 0;
  for (const count of counts.values()) {
    if (count > maxVotes) maxVotes = count;
  }
  const tied: number[] = [];
  for (const [idx, count] of counts.entries()) {
    if (count === maxVotes) tied.push(idx);
  }
  if (tied.length === 1) {
    return {
      targetIdx: tied[0],
      hasElimination: true,
      info: `Consensus on player ${tied[0]}.`,
    };
  }
  if (isNight) {
    const pick = tied[Math.floor(Math.random() * tied.length)];
    return {
      targetIdx: pick,
      hasElimination: true,
      info: `Night tie; randomly selected player ${pick}.`,
    };
  }
  return {
    targetIdx: 0,
    hasElimination: false,
    info: `Day tie; no elimination.`,
  };
};

const pickRandomAlive = (players: PlayerLocalState[]) => {
  const alive = players.filter((p) => p.alive);
  if (alive.length === 0) return null;
  return alive[Math.floor(Math.random() * alive.length)];
};

const pickRandomAliveNonWerewolf = (players: PlayerLocalState[]) => {
  const candidates = players.filter((p) => p.alive && p.role !== Role.Werewolf);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
};

const aliveCount = (players: PlayerLocalState[]) =>
  players.reduce((acc, p) => acc + (p.alive ? 1 : 0), 0);

const getOutcome = (players: PlayerLocalState[]) => {
  const alive = players.filter((p) => p.alive);
  const werewolves = alive.filter((p) => p.role === Role.Werewolf).length;
  const villagers = alive.length - werewolves;
  if (alive.length <= 1) {
    return "Only one survivor left.";
  }
  if (werewolves === 0) {
    return "All werewolves eliminated.";
  }
  if (werewolves >= villagers) {
    return "Werewolves reached parity.";
  }
  return null;
};

const shuffle = <T,>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const parseCount = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

class RuntimeMerkleTree {
  readonly depth: number;
  readonly leaves: Uint8Array[];
  readonly leafDigests: bigint[];
  readonly levels: bigint[][];
  readonly root: { field: bigint };
  readonly contract: WerewolfRuntimeContract;

  constructor(
    contract: WerewolfRuntimeContract,
    leaves: Uint8Array[],
    depth = 10,
  ) {
    this.contract = contract;
    this.depth = depth;
    this.leaves = leaves;

    const totalLeaves = 1 << depth;
    const zeroLeaf = new Uint8Array(32);
    const zeroDigest = this.computeLeafDigest(zeroLeaf);

    const digests = new Array<bigint>(totalLeaves);
    for (let i = 0; i < totalLeaves; i++) {
      const leaf = i < leaves.length ? leaves[i] : zeroLeaf;
      digests[i] = i < leaves.length
        ? this.computeLeafDigest(leaf)
        : zeroDigest;
    }

    this.leafDigests = digests;
    this.levels = [digests];

    for (let level = 0; level < depth; level++) {
      const prev = this.levels[level];
      const next: bigint[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        next.push(this.hashPair(prev[i], prev[i + 1]));
      }
      this.levels.push(next);
    }

    this.root = { field: this.levels[depth][0] };
  }

  getRoot() {
    return this.root;
  }

  getProof(index: number, leaf: Uint8Array) {
    const pathEntries: { sibling: { field: bigint }; goes_left: boolean }[] =
      [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      const siblingIdx = idx ^ 1;
      const siblingDigest = this.levels[level][siblingIdx];
      const goes_left = idx % 2 === 0;
      pathEntries.push({ sibling: { field: siblingDigest }, goes_left });
      idx = Math.floor(idx / 2);
    }
    return { leaf, path: pathEntries };
  }

  private computeLeafDigest(leaf: Uint8Array): bigint {
    const domain_sep = new Uint8Array([109, 100, 110, 58, 108, 104]); // "mdn:lh"
    const bytes = this.contract._persistentHash_7({ domain_sep, data: leaf });
    return this.contract._degradeToTransient_0(bytes);
  }

  private hashPair(left: bigint, right: bigint): bigint {
    return this.contract._transientHash_0([left, right]);
  }
}

function App() {
  const [loading, setLoading] = useState(false);
  const [midnightWallet, setMidnightWallet] = useState<any>(null);
  const [midnightProviders, setMidnightProviders] = useState<any>(null);
  const [midnightAddress, setMidnightAddress] = useState("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [txTimer, setTxTimer] = useState<{
    start: number | null;
    elapsed: number;
  }>({ start: null, elapsed: 0 });
  const [game, setGame] = useState<GameState | null>(null);
  const [nightVotes, setNightVotes] = useState<number[]>([]);
  const [dayVotes, setDayVotes] = useState<number[]>([]);
  const [revealPlayerIdx, setRevealPlayerIdx] = useState(0);
  const [playerCountInput, setPlayerCountInput] = useState("5");
  const [werewolfCountInput, setWerewolfCountInput] = useState("1");
  const [ledgerMapName, setLedgerMapName] = useState("");
  const [ledgerArgsInput, setLedgerArgsInput] = useState("");
  const [nightActionPayloadInput, setNightActionPayloadInput] = useState("");
  const [dayVotePayloadInput, setDayVotePayloadInput] = useState("");
  const [nightActionEncryptedHex, setNightActionEncryptedHex] = useState("");
  const [dayVoteEncryptedHex, setDayVoteEncryptedHex] = useState("");
  const [playerBundleInput, setPlayerBundleInput] = useState("");
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(
    null,
  );
  const [playerTargetIdxInput, setPlayerTargetIdxInput] = useState("0");
  const [playerNightPayloadInput, setPlayerNightPayloadInput] = useState("");
  const [playerDayPayloadInput, setPlayerDayPayloadInput] = useState("");
  const [playerLastEncryptedHex, setPlayerLastEncryptedHex] = useState("");

  const runtimeWitnesses = useMemo(
    () => ({
      wit_getSetupData: () => {
        throw new Error("Witness not configured in frontend.");
      },
      wit_getActionData: () => {
        throw new Error("Witness not configured in frontend.");
      },
    }),
    [],
  );

  const runtimeContract = useMemo(
    () => new WerewolfRuntimeContract(runtimeWitnesses as any),
    [runtimeWitnesses],
  );

  const ledgerState = midnightWallet?.stateB?.werewolf ?? null;
  const ledgerMaps = useMemo(() => {
    if (!ledgerState || typeof ledgerState !== "object") {
      return [];
    }
    return Object.keys(ledgerState)
      .filter((key) => {
        const map = (ledgerState as any)[key];
        return map && typeof map.isEmpty === "function";
      })
      .sort();
  }, [ledgerState]);

  const playerBundles = useMemo(() => {
    if (!game) return [];
    return game.players.map((player) => {
      const proof = game.tree.getProof(player.id, player.leaf);
      return {
        gameId: bytesToHex(game.gameId),
        playerId: player.id,
        leafSecret: bytesToHex(player.sk),
        merklePath: proof.path.map((entry) => ({
          sibling: { field: entry.sibling.field.toString() },
          goes_left: entry.goes_left,
        })),
        adminVotePublicKeyHex: game.adminVotePublicKeyHex,
        role: player.role,
      } satisfies PlayerBundle;
    });
  }, [game]);

  useEffect(() => {
    if (!ledgerMapName && ledgerMaps.length > 0) {
      setLedgerMapName(ledgerMaps[0]);
    }
  }, [ledgerMapName, ledgerMaps]);

  useEffect(() => {
    if (txTimer.start == null) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      setTxTimer((prev) =>
        prev.start == null ? prev : { ...prev, elapsed: prev.elapsed + 1 }
      );
    }, 1000);
    return () => globalThis.clearInterval(intervalId);
  }, [txTimer.start]);

  const parseBytes32 = (value: string, label: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Missing ${label}.`);
    }
    let hex: string;
    if (/^\d+$/.test(trimmed)) {
      const numeric = BigInt(trimmed);
      if (numeric < 0n) {
        throw new Error(`${label} must be a non-negative integer.`);
      }
      hex = numeric.toString(16);
    } else {
      hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
    }

    if (hex.length % 2 !== 0) {
      hex = `0${hex}`;
    }
    if (hex.length > 64) {
      throw new Error(`${label} must be 32 bytes (64 hex chars).`);
    }
    if (hex.length < 64) {
      hex = hex.padStart(64, "0");
    }

    const bytes = fromHex(hex);
    if (bytes.length !== 32) {
      throw new Error(`${label} must be 32 bytes (64 hex chars).`);
    }
    return bytes;
  };

  const parseBytes32FromUnknown = (value: unknown, label: string) => {
    if (value instanceof Uint8Array) {
      if (value.length !== 32) {
        throw new Error(`${label} must be 32 bytes.`);
      }
      return value;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint"
    ) {
      return parseBytes32(String(value), label);
    }
    if (Array.isArray(value)) {
      const bytes = Uint8Array.from(value);
      if (bytes.length !== 32) {
        throw new Error(`${label} must be 32 bytes.`);
      }
      return bytes;
    }
    if (value && typeof value === "object" && "bytes" in value) {
      return parseBytes32FromUnknown(
        (value as { bytes: unknown }).bytes,
        label,
      );
    }
    throw new Error(`${label} must be 32 bytes.`);
  };

  const parsePlayerBundle = (raw: string): PlayerProfile => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("Player bundle must be valid JSON.");
    }
    if (Array.isArray(parsed)) {
      if (parsed.length !== 1) {
        throw new Error("Paste a single player bundle (not an array).");
      }
      parsed = parsed[0];
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Player bundle must be an object.");
    }
    const bundle = parsed as PlayerBundle;
    if (!bundle.gameId || !bundle.leafSecret || !bundle.adminVotePublicKeyHex) {
      throw new Error("Player bundle missing required fields.");
    }
    if (!Array.isArray(bundle.merklePath)) {
      throw new Error("Player bundle merklePath must be an array.");
    }
    const merklePath = bundle.merklePath.map((entry, idx) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.goes_left !== "boolean" ||
        !entry.sibling ||
        typeof entry.sibling.field === "undefined"
      ) {
        throw new Error(`Invalid merklePath entry at index ${idx}.`);
      }
      const fieldValue = entry.sibling.field;
      const field = typeof fieldValue === "bigint"
        ? fieldValue
        : BigInt(fieldValue);
      return {
        sibling: { field },
        goes_left: entry.goes_left,
      };
    });
    return {
      gameId: parseBytes32(bundle.gameId, "gameId"),
      playerId: bundle.playerId,
      leafSecret: parseBytes32(bundle.leafSecret, "leafSecret"),
      merklePath,
      adminVotePublicKeyHex: bundle.adminVotePublicKeyHex,
      role: bundle.role,
    };
  };

  const normalizeLedgerArg = (value: unknown, label: string): unknown => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return trimmed;
      }
      if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
        return parseBytes32(trimmed, label);
      }
      if (/^\d+$/.test(trimmed)) {
        return BigInt(trimmed);
      }
      return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return Number.isInteger(value) ? BigInt(value) : value;
    }
    if (Array.isArray(value)) {
      if (
        value.length === 32 && value.every((item) => typeof item === "number")
      ) {
        return Uint8Array.from(value);
      }
      return value.map((item, idx) =>
        normalizeLedgerArg(item, `${label}[${idx}]`)
      );
    }
    if (value && typeof value === "object") {
      if ("bytes" in value) {
        return {
          ...(value as Record<string, unknown>),
          bytes: parseBytes32FromUnknown(
            (value as { bytes: unknown }).bytes,
            `${label}.bytes`,
          ),
        };
      }
      if ("field" in value) {
        const fieldValue = (value as { field: unknown }).field;
        if (typeof fieldValue === "string" && /^\d+$/.test(fieldValue.trim())) {
          return {
            ...(value as Record<string, unknown>),
            field: BigInt(fieldValue),
          };
        }
      }
    }
    return value;
  };

  const stageSetupData = async (
    gameId: Uint8Array,
    commitments: Uint8Array[],
  ) => {
    if (!midnightProviders?.privateStateProvider?.set) {
      throw new Error("Private state provider not available.");
    }
    const roleCommitments = [...commitments];
    while (roleCommitments.length < MAX_PLAYERS) {
      roleCommitments.push(new Uint8Array(32));
    }
    const key = toHexString(gameId);
    await midnightProviders.privateStateProvider.set("werewolfPrivateState", {
      setupData: new Map([[key, { roleCommitments }]]),
      nextAction: undefined,
    });
  };

  const stageNextAction = async (
    gameId: Uint8Array,
    action: {
      encryptedAction: Uint8Array;
      merklePath: {
        leaf: Uint8Array;
        path: { sibling: { field: bigint }; goes_left: boolean }[];
      };
      leafSecret: Uint8Array;
    },
  ) => {
    if (!midnightProviders?.privateStateProvider?.set) {
      throw new Error("Private state provider not available.");
    }
    const key = toHexString(gameId);
    await midnightProviders.privateStateProvider.set("werewolfPrivateState", {
      setupData: new Map([[key, {
        roleCommitments: Array.from({ length: MAX_PLAYERS }, () =>
          new Uint8Array(32)),
      }]]),
      nextAction: action,
    });
  };

  const getRoundEncryptedVotes = (
    state: any,
    gameId: Uint8Array,
    phase: number,
    round: number,
  ): Uint8Array[] => {
    const votesMap = state?.roundEncryptedVotes;
    if (!votesMap || typeof votesMap.member !== "function") {
      throw new Error("Ledger roundEncryptedVotes map not available.");
    }
    const roundPrefix = padBytes32(
      phase === Phase.Day ? "day-round" : "night-round",
    );
    const roundHash = runtimeContract._persistentHash_3(BigInt(round));
    const countKey = runtimeContract._hash2_0(
      (runtimeContract as any)._hash2_0(gameId, roundPrefix),
      roundHash,
    );
    const emptyVote = new Uint8Array(129);
    if (!votesMap.member(countKey)) {
      return Array.from({ length: MAX_PLAYERS }, () => emptyVote);
    }
    const roundMap = votesMap.lookup(countKey);
    return Array.from({ length: MAX_PLAYERS }, (_, idx) => {
      const key = BigInt(idx);
      return roundMap.member(key) ? roundMap.lookup(key) : emptyVote;
    });
  };

  const decryptVoteTargets = (
    encryptedVotes: Uint8Array[],
    adminVotePrivateKeyHex: string,
    isNight: boolean,
    werewolfIndices: number[],
  ): number[] => {
    const targets: number[] = [];
    for (let i = 0; i < encryptedVotes.length; i++) {
      const enc = encryptedVotes[i];
      if (!enc || isZeroBytes(enc)) continue;
      if (isNight && !werewolfIndices.includes(i)) continue;
      try {
        const dec = decrypt(adminVotePrivateKeyHex, Buffer.from(enc));
        const payload = dec instanceof Uint8Array ? dec : new Uint8Array(dec);
        targets.push(decodeVoteTarget(payload));
      } catch (e) {
        console.warn("Failed to decrypt vote payload", e);
      }
    }
    return targets;
  };

  const getAdminKeyBytes = () => {
    const adminKeySource =
      midnightWallet?.stateA?.werewolf?.shieldedCoinPublicKey ??
        midnightWallet?.stateA?.werewolf?.coinPublicKey ??
        midnightWallet?.stateA?.werewolf?.shieldedCoinPublicKey?.bytes;

    if (!adminKeySource) {
      throw new Error("Wallet coin public key not available.");
    }
    return parseBytes32FromUnknown(adminKeySource, "adminKey");
  };

  const handleConnectMidnight = async () => {
    setError("");
    setStatus("");
    setLoading(true);
    try {
      const data = await loginMidnight();
      setMidnightWallet(data);
      setMidnightProviders(data?.providers ?? null);
      setMidnightAddress(data?.addr ?? "");
      setStatus("Connected to Midnight wallet.");
    } catch (e: any) {
      console.error("Failed to connect Midnight wallet:", e);
      setError(e?.message ?? "Failed to connect Midnight wallet.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleAddFunds = async () => {
    setError("");
    setStatus("");
    if (!midnightAddress) {
      setError("Connect Midnight wallet first.");
      return;
    }

    setLoading(true);
    try {
      const url = `http://localhost:9999/api/faucet/nights?address=${
        encodeURIComponent(
          midnightAddress,
        )
      }`;
      const resp = await fetch(url);
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(
          (data && typeof data === "object" && "message" in data
            ? (data as any).message
            : undefined) ??
            `Faucet request failed (HTTP ${resp.status})`,
        );
      }
      setStatus(`Faucet response:\n${stringifyWithBigInt(data)}`);
    } catch (e: any) {
      console.error("Faucet request failed:", e);
      setError(e?.message ?? "Faucet request failed.");
    } finally {
      setLoading(false);
    }
  };

  const parseLedgerArgs = () => {
    const raw = ledgerArgsInput.trim();
    if (!raw) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("Ledger args must be valid JSON.");
    }
    const args = Array.isArray(parsed) ? parsed : [parsed];
    return args.map((value, idx) => normalizeLedgerArg(value, `arg${idx + 1}`));
  };

  const handleLedgerMapCall = (
    method: "isEmpty" | "size" | "member" | "lookup" | "iterator",
  ) => {
    setError("");
    setStatus("");
    if (!ledgerState) {
      setError("Ledger state not available. Connect wallet first.");
      return;
    }
    if (!ledgerMapName) {
      setError("Select a ledger map first.");
      return;
    }

    const map = (ledgerState as any)[ledgerMapName];
    if (!map) {
      setError(`Ledger map not found: ${ledgerMapName}`);
      return;
    }

    try {
      setLoading(true);
      if (method !== "iterator" && typeof map[method] !== "function") {
        throw new Error(
          `Ledger map method not found: ${ledgerMapName}.${method}`,
        );
      }
      const args =
        method === "isEmpty" || method === "size" || method === "iterator"
          ? []
          : parseLedgerArgs();
      const result = method === "iterator"
        ? Array.from(map as Iterable<unknown>)
        : map[method](...args);
      setStatus(`${ledgerMapName}.${method}:\n${stringifyWithBigInt(result)}`);
    } catch (e: any) {
      console.error(`Ledger map call failed (${ledgerMapName}.${method})`, e);
      setError(
        e?.message ?? `Ledger map call failed: ${ledgerMapName}.${method}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const refreshLedgerState = async () => {
    if (!midnightProviders) {
      throw new Error("Connect Midnight wallet first.");
    }
    const contractAddress = midnightWallet?.contractAddress?.werewolf;
    if (!contractAddress) {
      throw new Error("Contract address not available.");
    }
    const { contract, state } = await connectToContract(
      midnightProviders,
      contractAddress,
    );
    setMidnightWallet((prev: any) =>
      prev
        ? {
          ...prev,
          contract: { ...prev.contract, werewolf: contract },
          stateB: { ...prev.stateB, werewolf: state },
        }
        : prev
    );
    return state;
  };

  const handleRefreshLedgerState = async () => {
    setError("");
    setStatus("");
    setLoading(true);
    try {
      await refreshLedgerState();
      setStatus("Ledger state refreshed.");
    } catch (e: any) {
      console.error("Failed to refresh ledger state:", e);
      setError(e?.message ?? "Failed to refresh ledger state.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGame = async () => {
    setError("");
    setStatus("");
    if (!midnightWallet?.contract?.werewolf) {
      setError("Connect Midnight wallet first.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const playerCount = Math.min(
        MAX_PLAYERS,
        Math.max(2, parseCount(playerCountInput, 5)),
      );
      const werewolfCount = Math.min(
        Math.max(1, parseCount(werewolfCountInput, 1)),
        playerCount - 1,
      );

      const adminKeyBytes = getAdminKeyBytes();
      const gameId = randomBytes32();
      const adminVoteKey = new PrivateKey();
      const adminVotePublicKeyHex = adminVoteKey.publicKey.toHex();
      const adminVotePublicKeyBytes = hexToBytes(adminVotePublicKeyHex);
      const masterSecret = randomBytes32();
      const masterSecretCommitment = new Uint8Array(
        pureCircuits.testComputeHash(masterSecret),
      );

      const roles = shuffle(
        Array.from(
          { length: playerCount },
          (_, idx) => idx < werewolfCount ? Role.Werewolf : Role.Villager,
        ),
      );

      const players: PlayerLocalState[] = roles.map((role, id) => {
        const sk = randomBytes32();
        const pk = randomBytes32();
        const salt = new Uint8Array(
          (pureCircuits as any).testComputeSalt(masterSecret, BigInt(id)),
        );
        const commitment = new Uint8Array(
          (pureCircuits as any).testComputeCommitment(BigInt(role), salt),
        );
        const leaf = new Uint8Array(
          (pureCircuits as any).testComputeHash(sk),
        );
        return {
          id,
          pk,
          sk,
          role,
          salt,
          alive: true,
          commitment,
          leaf,
        };
      });

      const tree = new RuntimeMerkleTree(
        runtimeContract,
        players.map((p) => p.leaf),
      );
      const initialRoot = tree.getRoot();

      await stageSetupData(gameId, players.map((p) => p.commitment));

      setStatus("Creating game…");
      await callWerewolfMethod(midnightWallet.contract.werewolf, "createGame", [
        gameId,
        { bytes: adminKeyBytes },
        adminVotePublicKeyBytes,
        masterSecretCommitment,
        BigInt(playerCount),
        BigInt(werewolfCount),
        initialRoot,
      ]);

      setGame({
        gameId,
        masterSecret,
        masterSecretCommitment,
        adminVotePrivateKeyHex: adminVoteKey.toHex(),
        adminVotePublicKeyHex,
        adminVotePublicKeyBytes,
        players,
        tree,
        round: 1,
        phase: Phase.Night,
        playerCount,
        werewolfCount,
      });
      setNightVotes([]);
      setDayVotes([]);
      setRevealPlayerIdx(0);
      setStatus(
        `Game created.\n\nGameId: 0x${
          toHexString(gameId)
        }\nPlayers: ${playerCount}\nWerewolves: ${werewolfCount}`,
      );
    } catch (e: any) {
      console.error("Create game failed:", e);
      setError(e?.message ?? "Create game failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleLoadPlayerBundle = () => {
    setError("");
    setStatus("");
    try {
      const profile = parsePlayerBundle(playerBundleInput.trim());
      setPlayerProfile(profile);
      setStatus(
        `Loaded player ${profile.playerId} (game ${
          bytesToHex(profile.gameId)
        }).`,
      );
    } catch (e: any) {
      console.error("Failed to load player bundle:", e);
      setError(e?.message ?? "Failed to load player bundle.");
    }
  };

  const handleClearPlayerBundle = () => {
    setPlayerProfile(null);
    setPlayerBundleInput("");
    setPlayerLastEncryptedHex("");
  };

  const handleSubmitNightActions = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }
    if (game.phase !== Phase.Night) {
      setError("Night actions are only allowed during the Night phase.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const targets: number[] = [];
      let lastEncryptedHex = "";
      for (const player of game.players) {
        if (!player.alive) continue;
        const nightTarget = pickRandomAliveNonWerewolf(game.players) ??
          pickRandomAlive(game.players);
        const targetIdx = nightTarget ? nightTarget.id : 0;
        const payloadBytes = nightActionPayloadInput.trim()
          ? parseBytes32(nightActionPayloadInput, "Night action payload")
          : encodeVoteTarget(targetIdx);
        const encryptedAction = encryptPayload(
          game.adminVotePublicKeyHex,
          payloadBytes,
        );
        lastEncryptedHex = bytesToHex(encryptedAction);
        const path = game.tree.getProof(player.id, player.leaf);

        await stageNextAction(game.gameId, {
          encryptedAction,
          merklePath: path,
          leafSecret: player.sk,
        });
        await callWerewolfMethod(
          midnightWallet.contract.werewolf,
          "nightAction",
          [game.gameId],
        );
        targets.push(decodeVoteTarget(payloadBytes));
      }

      setNightVotes(targets);
      setNightActionEncryptedHex(lastEncryptedHex);
      setStatus(
        `Night actions submitted for ${targets.length} players.`,
      );
    } catch (e: any) {
      console.error("Night action failed:", e);
      setError(e?.message ?? "Night action failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleResolveNight = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const latestLedgerState = midnightProviders
        ? await refreshLedgerState()
        : ledgerState;
      if (!latestLedgerState) {
        throw new Error(
          "Ledger state unavailable. Refresh ledger state first.",
        );
      }
      const encryptedVotes = getRoundEncryptedVotes(
        latestLedgerState,
        game.gameId,
        Phase.Night,
        game.round,
      );
      const werewolfIndices = game.players
        .filter((p) => p.role === Role.Werewolf)
        .map((p) => p.id);
      const voteTargets = decryptVoteTargets(
        encryptedVotes,
        game.adminVotePrivateKeyHex,
        true,
        werewolfIndices,
      );
      if (voteTargets.length === 0) {
        throw new Error("No decryptable night votes found.");
      }
      setNightVotes(voteTargets);

      const result = resolveVotes(voteTargets, game.players, true);
      const hasDeath = result.hasElimination && aliveCount(game.players) > 1;
      const targetIdx = result.targetIdx;

      await callWerewolfMethod(
        midnightWallet.contract.werewolf,
        "resolveNightPhase",
        [
          game.gameId,
          BigInt(game.round + 1),
          BigInt(targetIdx),
          hasDeath,
          game.tree.getRoot(),
        ],
      );

      const nextPlayers = game.players.map((p) =>
        hasDeath && p.id === targetIdx ? { ...p, alive: false } : p
      );
      const outcome = getOutcome(nextPlayers);

      setGame({
        ...game,
        players: nextPlayers,
        round: game.round + 1,
        phase: outcome ? Phase.Finished : Phase.Day,
      });
      setNightVotes([]);
      setStatus(
        outcome
          ? `Night resolved. ${result.info} ${outcome} Game finished.`
          : `Night resolved. ${result.info} Player ${targetIdx} ${
            hasDeath ? "died" : "survived"
          }.`,
      );
    } catch (e: any) {
      console.error("Resolve night failed:", e);
      setError(e?.message ?? "Resolve night failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleSubmitDayVotes = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }
    if (game.phase !== Phase.Day) {
      setError("Day votes are only allowed during the Day phase.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const targets: number[] = [];
      let lastEncryptedHex = "";
      for (const player of game.players) {
        if (!player.alive) continue;
        const dayTarget = pickRandomAlive(game.players);
        const targetIdx = dayTarget ? dayTarget.id : 0;
        const payloadBytes = dayVotePayloadInput.trim()
          ? parseBytes32(dayVotePayloadInput, "Day vote payload")
          : encodeVoteTarget(targetIdx);
        const encryptedVote = encryptPayload(
          game.adminVotePublicKeyHex,
          payloadBytes,
        );
        lastEncryptedHex = bytesToHex(encryptedVote);
        const path = game.tree.getProof(player.id, player.leaf);

        await stageNextAction(game.gameId, {
          encryptedAction: encryptedVote,
          merklePath: path,
          leafSecret: player.sk,
        });
        await callWerewolfMethod(midnightWallet.contract.werewolf, "voteDay", [
          game.gameId,
        ]);
        targets.push(decodeVoteTarget(payloadBytes));
      }

      setDayVotes(targets);
      setDayVoteEncryptedHex(lastEncryptedHex);
      setStatus(`Day votes submitted for ${targets.length} players.`);
    } catch (e: any) {
      console.error("Day vote failed:", e);
      setError(e?.message ?? "Day vote failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleSubmitPlayerNightAction = async () => {
    setError("");
    setStatus("");
    if (!playerProfile || !midnightWallet?.contract?.werewolf) {
      setError("Load a player bundle first.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const payloadBytes = playerNightPayloadInput.trim()
        ? parseBytes32(playerNightPayloadInput, "Night action payload")
        : encodeVoteTarget(parseCount(playerTargetIdxInput, 0));
      const encryptedAction = encryptPayload(
        playerProfile.adminVotePublicKeyHex,
        payloadBytes,
      );
      const leaf = new Uint8Array(
        (pureCircuits as any).testComputeHash(playerProfile.leafSecret),
      );
      const path = { leaf, path: playerProfile.merklePath };

      await stageNextAction(playerProfile.gameId, {
        encryptedAction,
        merklePath: path,
        leafSecret: playerProfile.leafSecret,
      });
      await callWerewolfMethod(
        midnightWallet.contract.werewolf,
        "nightAction",
        [playerProfile.gameId],
      );

      setPlayerLastEncryptedHex(bytesToHex(encryptedAction));
      setStatus("Night action submitted.");
    } catch (e: any) {
      console.error("Player night action failed:", e);
      setError(e?.message ?? "Player night action failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleSubmitPlayerDayVote = async () => {
    setError("");
    setStatus("");
    if (!playerProfile || !midnightWallet?.contract?.werewolf) {
      setError("Load a player bundle first.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const payloadBytes = playerDayPayloadInput.trim()
        ? parseBytes32(playerDayPayloadInput, "Day vote payload")
        : encodeVoteTarget(parseCount(playerTargetIdxInput, 0));
      const encryptedVote = encryptPayload(
        playerProfile.adminVotePublicKeyHex,
        payloadBytes,
      );
      const leaf = new Uint8Array(
        (pureCircuits as any).testComputeHash(playerProfile.leafSecret),
      );
      const path = { leaf, path: playerProfile.merklePath };

      await stageNextAction(playerProfile.gameId, {
        encryptedAction: encryptedVote,
        merklePath: path,
        leafSecret: playerProfile.leafSecret,
      });
      await callWerewolfMethod(
        midnightWallet.contract.werewolf,
        "voteDay",
        [playerProfile.gameId],
      );

      setPlayerLastEncryptedHex(bytesToHex(encryptedVote));
      setStatus("Day vote submitted.");
    } catch (e: any) {
      console.error("Player day vote failed:", e);
      setError(e?.message ?? "Player day vote failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleResolveDay = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const latestLedgerState = midnightProviders
        ? await refreshLedgerState()
        : ledgerState;
      if (!latestLedgerState) {
        throw new Error(
          "Ledger state unavailable. Refresh ledger state first.",
        );
      }
      const encryptedVotes = getRoundEncryptedVotes(
        latestLedgerState,
        game.gameId,
        Phase.Day,
        game.round,
      );
      const voteTargets = decryptVoteTargets(
        encryptedVotes,
        game.adminVotePrivateKeyHex,
        false,
        [],
      );
      if (voteTargets.length === 0) {
        throw new Error("No decryptable day votes found.");
      }
      setDayVotes(voteTargets);

      const result = resolveVotes(voteTargets, game.players, false);
      const hasElimination = result.hasElimination &&
        aliveCount(game.players) > 1;
      const targetIdx = result.targetIdx;

      await callWerewolfMethod(
        midnightWallet.contract.werewolf,
        "resolveDayPhase",
        [game.gameId, BigInt(targetIdx), hasElimination],
      );

      const nextPlayers = game.players.map((p) =>
        hasElimination && p.id === targetIdx ? { ...p, alive: false } : p
      );
      const outcome = getOutcome(nextPlayers);

      setGame({
        ...game,
        players: nextPlayers,
        phase: outcome ? Phase.Finished : Phase.Night,
      });
      setDayVotes([]);
      setStatus(
        outcome
          ? `Day resolved. ${result.info} ${outcome} Game finished.`
          : `Day resolved. ${result.info} Player ${targetIdx} ${
            hasElimination ? "eliminated" : "survived"
          }.`,
      );
    } catch (e: any) {
      console.error("Resolve day failed:", e);
      setError(e?.message ?? "Resolve day failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleRevealRole = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }
    const player = game.players.find((p) => p.id === revealPlayerIdx);
    if (!player) {
      setError("Select a valid player.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      await callWerewolfMethod(
        midnightWallet.contract.werewolf,
        "revealPlayerRole",
        [
          game.gameId,
          BigInt(player.id),
          BigInt(player.role),
          player.salt,
        ],
      );
      setStatus(`Revealed player ${player.id} role: ${roleName(player.role)}.`);
    } catch (e: any) {
      console.error("Reveal role failed:", e);
      setError(e?.message ?? "Reveal role failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleVerifyFairness = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }
    const player = game.players.find((p) => p.id === revealPlayerIdx);
    if (!player) {
      setError("Select a valid player.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const result = await callWerewolfMethod(
        midnightWallet.contract.werewolf,
        "verifyFairness",
        [
          game.gameId,
          game.masterSecret,
          BigInt(player.id),
          BigInt(player.role),
        ],
      );
      setStatus(`Verify fairness result: ${stringifyWithBigInt(result)}`);
    } catch (e: any) {
      console.error("Verify fairness failed:", e);
      setError(e?.message ?? "Verify fairness failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleForceEndGame = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      await callWerewolfMethod(
        midnightWallet.contract.werewolf,
        "forceEndGame",
        [
          game.gameId,
          game.masterSecret,
        ],
      );
      setGame({ ...game, phase: Phase.Finished });
      setStatus("Force ended the game.");
    } catch (e: any) {
      console.error("Force end game failed:", e);
      setError(e?.message ?? "Force end game failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
  };

  const handleResetGame = () => {
    setGame(null);
    setNightVotes([]);
    setDayVotes([]);
    setRevealPlayerIdx(0);
    setStatus("Game state cleared.");
  };

  return (
    <div className="page">
      <div className="card">
        <div className="title">Midnight dApp</div>
        <div className="subtitle">Werewolf game (Trusted Node view)</div>

        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={handleConnectMidnight}
            disabled={loading || Boolean(midnightAddress)}
            title={midnightAddress ? "Wallet already connected" : undefined}
          >
            {midnightAddress
              ? "Midnight Wallet Connected"
              : "Connect Midnight Wallet"}
          </button>

          <button
            type="button"
            className="btn"
            onClick={handleAddFunds}
            disabled={loading || !midnightAddress}
            title={!midnightAddress ? "Connect wallet first" : undefined}
          >
            Add funds
          </button>

          <button
            type="button"
            className="btn"
            onClick={handleRefreshLedgerState}
            disabled={loading || !midnightAddress}
            title={!midnightAddress ? "Connect wallet first" : undefined}
          >
            Refresh ledger
          </button>
        </div>

        {game && (
          <div className="info">
            <div className="label">Game info</div>
            <div className="mono">
              {`GameId: 0x${
                toHexString(game.gameId)
              }\nRound: ${game.round}\nPhase: ${
                phaseName(game.phase)
              }\nPlayers: ${game.playerCount}\nWerewolves: ${game.werewolfCount}`}
            </div>
          </div>
        )}

        <div className="columns">
          <div className="column">
            <div className="column-title">Trusted Node Actions</div>
            <div className="form">
              <div className="label">Game setup</div>
              <div className="field">
                <div className="label">Players (max {MAX_PLAYERS})</div>
                <input
                  className="input"
                  type="number"
                  min={2}
                  max={MAX_PLAYERS}
                  value={playerCountInput}
                  onChange={(event) => setPlayerCountInput(event.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="field">
                <div className="label">Werewolves</div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={MAX_PLAYERS - 1}
                  value={werewolfCountInput}
                  onChange={(event) =>
                    setWerewolfCountInput(event.target.value)}
                  disabled={loading}
                />
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateGame}
                disabled={loading || !midnightAddress}
                title={!midnightAddress ? "Connect wallet first" : undefined}
              >
                Create + setup game
              </button>

              <button
                type="button"
                className="btn"
                onClick={handleResetGame}
                disabled={loading}
              >
                Reset local game state
              </button>
            </div>

            {game && playerBundles.length > 0 && (
              <div className="form">
                <div className="label">Player bundles</div>
                <div className="mono">
                  Share one bundle per player. Night filtering assumes
                  submissions are in player-id order.
                </div>
                {playerBundles.map((bundle) => (
                  <div className="field" key={bundle.playerId}>
                    <div className="label">Player {bundle.playerId}</div>
                    <textarea
                      className="input"
                      rows={6}
                      readOnly
                      value={JSON.stringify(bundle, null, 2)}
                    />
                  </div>
                ))}
              </div>
            )}

            {game && (
              <div className="form">
                <div className="label">Night resolution</div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleResolveNight}
                  disabled={loading || game.phase !== Phase.Night}
                >
                  Resolve night
                </button>
              </div>
            )}

            {game && (
              <div className="form">
                <div className="label">Day resolution</div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleResolveDay}
                  disabled={loading || game.phase !== Phase.Day}
                >
                  Resolve day
                </button>
              </div>
            )}

            {game && (
              <div className="form">
                <div className="label">Admin control</div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleForceEndGame}
                  disabled={loading}
                >
                  Force end game
                </button>
              </div>
            )}

            {ledgerState && (
              <div className="form">
                <div className="label">Ledger state</div>
                <div className="field">
                  <div className="label">Map</div>
                  <select
                    className="input"
                    value={ledgerMapName}
                    onChange={(event) => setLedgerMapName(event.target.value)}
                    disabled={loading || ledgerMaps.length === 0}
                  >
                    {ledgerMaps.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <div className="label">Args (JSON)</div>
                  <input
                    className="input"
                    type="text"
                    value={ledgerArgsInput}
                    onChange={(event) => setLedgerArgsInput(event.target.value)}
                    placeholder='e.g. "0x..." or ["0x...", 1]'
                    disabled={loading}
                  />
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleLedgerMapCall("isEmpty")}
                  disabled={loading || !ledgerMapName}
                >
                  Map isEmpty
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleLedgerMapCall("size")}
                  disabled={loading || !ledgerMapName}
                >
                  Map size
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleLedgerMapCall("member")}
                  disabled={loading || !ledgerMapName}
                >
                  Map member
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleLedgerMapCall("lookup")}
                  disabled={loading || !ledgerMapName}
                >
                  Map lookup
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleLedgerMapCall("iterator")}
                  disabled={loading || !ledgerMapName}
                >
                  Map keys
                </button>
              </div>
            )}
          </div>

          <div className="column">
            <div className="column-title">Player Actions</div>
            <div className="form">
              <div className="label">Player bundle (single browser)</div>
              <div className="field">
                <div className="label">Bundle JSON</div>
                <textarea
                  className="input"
                  rows={6}
                  value={playerBundleInput}
                  onChange={(event) => setPlayerBundleInput(event.target.value)}
                  placeholder='Paste JSON from "Player bundles"'
                  disabled={loading}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleLoadPlayerBundle}
                disabled={loading || !playerBundleInput.trim()}
              >
                Load player bundle
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleClearPlayerBundle}
                disabled={loading}
              >
                Clear player bundle
              </button>
              {playerProfile && (
                <div className="mono">
                  Loaded P{playerProfile.playerId} — game{" "}
                  {bytesToHex(playerProfile.gameId)}
                </div>
              )}
            </div>

            {playerProfile && (
              <div className="form">
                <div className="label">Single player actions</div>
                <div className="field">
                  <div className="label">Vote target (player index)</div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={MAX_PLAYERS - 1}
                    value={playerTargetIdxInput}
                    onChange={(event) =>
                      setPlayerTargetIdxInput(event.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <div className="label">
                    Night payload override (bytes32 hex)
                  </div>
                  <input
                    className="input"
                    type="text"
                    value={playerNightPayloadInput}
                    onChange={(event) =>
                      setPlayerNightPayloadInput(event.target.value)}
                    placeholder='e.g. "0x..."'
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <div className="label">
                    Day payload override (bytes32 hex)
                  </div>
                  <input
                    className="input"
                    type="text"
                    value={playerDayPayloadInput}
                    onChange={(event) =>
                      setPlayerDayPayloadInput(event.target.value)}
                    placeholder='e.g. "0x..."'
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <div className="label">Last encrypted payload</div>
                  <input
                    className="input"
                    type="text"
                    readOnly
                    value={playerLastEncryptedHex}
                    placeholder="Encrypted payload will appear here"
                    tabIndex={-1}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmitPlayerNightAction}
                  disabled={loading}
                >
                  Submit night action (player)
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmitPlayerDayVote}
                  disabled={loading}
                >
                  Submit day vote (player)
                </button>
              </div>
            )}

            {game && (
              <div className="form">
                <div className="label">Night phase (simulate all)</div>
                <div className="field">
                  <div className="label">
                    Night action payload (bytes32 hex)
                  </div>
                  <input
                    className="input"
                    type="text"
                    value={nightActionPayloadInput}
                    onChange={(event) =>
                      setNightActionPayloadInput(event.target.value)}
                    placeholder='e.g. "0x..."'
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <div className="label">Encrypted night action</div>
                  <input
                    className="input"
                    type="text"
                    readOnly
                    value={nightActionEncryptedHex}
                    placeholder="Encrypted payload will appear here"
                    tabIndex={-1}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmitNightActions}
                  disabled={loading || game.phase !== Phase.Night}
                >
                  Submit night actions (all alive)
                </button>
                {nightVotes.length > 0 && (
                  <div className="mono">
                    Night votes decoded: {nightVotes.join(", ")}
                  </div>
                )}
              </div>
            )}

            {game && (
              <div className="form">
                <div className="label">Day phase (simulate all)</div>
                <div className="field">
                  <div className="label">Day vote payload (bytes32 hex)</div>
                  <input
                    className="input"
                    type="text"
                    value={dayVotePayloadInput}
                    onChange={(event) =>
                      setDayVotePayloadInput(event.target.value)}
                    placeholder='e.g. "0x..."'
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <div className="label">Encrypted day vote</div>
                  <input
                    className="input"
                    type="text"
                    readOnly
                    value={dayVoteEncryptedHex}
                    placeholder="Encrypted payload will appear here"
                    tabIndex={-1}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmitDayVotes}
                  disabled={loading || game.phase !== Phase.Day}
                >
                  Submit day votes (all alive)
                </button>
                {dayVotes.length > 0 && (
                  <div className="mono">
                    Day votes decoded: {dayVotes.join(", ")}
                  </div>
                )}
              </div>
            )}

            {game && (
              <div className="form">
                <div className="label">Player proofs</div>
                <div className="field">
                  <div className="label">Player index</div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={game.players.length - 1}
                    value={revealPlayerIdx}
                    onChange={(event) =>
                      setRevealPlayerIdx(Number(event.target.value))}
                    disabled={loading}
                  />
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleRevealRole}
                  disabled={loading}
                >
                  Reveal player role
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleVerifyFairness}
                  disabled={loading}
                >
                  Verify fairness
                </button>
              </div>
            )}
          </div>
        </div>

        {game && (
          <div className="info">
            <div className="label">Players</div>
            <div className="mono">
              {game.players
                .map(
                  (player) =>
                    `P${player.id}: ${roleName(player.role)} (${
                      player.alive ? "alive" : "dead"
                    })`,
                )
                .join("\n")}
            </div>
          </div>
        )}

        {midnightAddress && (
          <div className="info">
            <div className="label">Connected address</div>
            <div className="mono">{midnightAddress}</div>
            {midnightWallet?.contractAddress?.werewolf && (
              <>
                <div className="label">Contract address</div>
                <div className="mono">
                  {midnightWallet.contractAddress.werewolf}
                </div>
              </>
            )}
          </div>
        )}

        {loading && txTimer.start != null && (
          <div className="timer-banner">
            Transaction running… {txTimer.elapsed}s elapsed.
          </div>
        )}
        {error && <pre className="message message-error">{error}</pre>}
        {status && <pre className="message message-ok">{status}</pre>}
      </div>
    </div>
  );
}

export default App;
