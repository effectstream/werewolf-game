import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { loginMidnight } from "./interface.ts";
import { callWerewolfMethod } from "./contracts/contract.ts";
import { fromHex } from "@midnight-ntwrk/compact-runtime";
import {
  Contract as WerewolfRuntimeContract,
  pureCircuits,
} from "../../../../shared/contracts/midnight/contract-werewolf/src/managed/contract/index.js";
import { witnesses as werewolfWitnesses } from "../../../../shared/contracts/midnight/contract-werewolf/src/witnesses.ts";
import { PrivateKey, encrypt } from "eciesjs";

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
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
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

const pickTargetFromVotes = (
  voteTargets: number[],
  players: PlayerLocalState[],
) => {
  const counts = new Map<number, number>();
  for (const targetIdx of voteTargets) {
    const target = players.find((p) => p.id === targetIdx);
    if (!target || !target.alive) continue;
    counts.set(targetIdx, (counts.get(targetIdx) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestIdx: number | null = null;
  let bestCount = -1;
  for (const [idx, count] of counts.entries()) {
    if (count > bestCount || (count === bestCount && idx < (bestIdx ?? idx))) {
      bestIdx = idx;
      bestCount = count;
    }
  }
  return bestIdx === null
    ? null
    : players.find((p) => p.id === bestIdx) ?? null;
};

const pickRandomAlive = (players: PlayerLocalState[]) => {
  const alive = players.filter((p) => p.alive);
  if (alive.length === 0) return null;
  return alive[Math.floor(Math.random() * alive.length)];
};

const pickRandomAliveNonWerewolf = (players: PlayerLocalState[]) => {
  const candidates = players.filter((p) =>
    p.alive && p.role !== Role.Werewolf
  );
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
  readonly contract: any;

  constructor(contract: any, leaves: Uint8Array[], depth = 10) {
    this.contract = contract;
    this.depth = depth;
    this.leaves = leaves;

    const totalLeaves = 1 << depth;
    const zeroLeaf = new Uint8Array(32);
    const zeroDigest = this.computeLeafDigest(zeroLeaf);

    const digests = new Array<bigint>(totalLeaves);
    for (let i = 0; i < totalLeaves; i++) {
      const leaf = i < leaves.length ? leaves[i] : zeroLeaf;
      digests[i] = i < leaves.length ? this.computeLeafDigest(leaf) : zeroDigest;
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
    const pathEntries: { sibling: { field: bigint }; goes_left: boolean }[] = [];
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
    const bytes = this.contract._persistentHash_1({ domain_sep, data: leaf });
    return this.contract._degradeToTransient_0(bytes);
  }

  private hashPair(left: bigint, right: bigint): bigint {
    return this.contract._transientHash_0([left, right]);
  }
}

function App() {
  const [loading, setLoading] = useState(false);
  const [midnightWallet, setMidnightWallet] = useState<any>(null);
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

  const runtimeContract = useMemo(
    () => new (WerewolfRuntimeContract as any)(werewolfWitnesses),
    [],
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
      if (value.length === 32 && value.every((item) => typeof item === "number")) {
        return Uint8Array.from(value);
      }
      return value.map((item, idx) => normalizeLedgerArg(item, `${label}[${idx}]`));
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
          return { ...(value as Record<string, unknown>), field: BigInt(fieldValue) };
        }
      }
    }
    return value;
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
        throw new Error(`Ledger map method not found: ${ledgerMapName}.${method}`);
      }
      const args = method === "isEmpty" || method === "size" || method === "iterator"
        ? []
        : parseLedgerArgs();
      const result = method === "iterator"
        ? Array.from(map as Iterable<unknown>)
        : map[method](...args);
      setStatus(`${ledgerMapName}.${method}:\n${stringifyWithBigInt(result)}`);
    } catch (e: any) {
      console.error(`Ledger map call failed (${ledgerMapName}.${method})`, e);
      setError(e?.message ?? `Ledger map call failed: ${ledgerMapName}.${method}`);
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
        (pureCircuits as any).testComputeHash(masterSecret),
      );

      const roles = shuffle(
        Array.from({ length: playerCount }, (_, idx) =>
          idx < werewolfCount ? Role.Werewolf : Role.Villager
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

      setStatus("Setting up player commitments…");
      const setupBatch = async (batch: PlayerLocalState[]) => {
        if (batch.length === 1) {
          await callWerewolfMethod(
            midnightWallet.contract.werewolf,
            "setupGame",
            [gameId, BigInt(batch[0].id), batch[0].commitment],
          );
          return;
        }
        if (batch.length === 2) {
          await callWerewolfMethod(
            midnightWallet.contract.werewolf,
            "setupGame2",
            [
              gameId,
              BigInt(batch[0].id),
              batch[0].commitment,
              BigInt(batch[1].id),
              batch[1].commitment,
            ],
          );
          return;
        }
        throw new Error(`Unsupported setup batch size: ${batch.length}`);
      };

      for (let i = 0; i < players.length;) {
        const remaining = players.length - i;
        if (remaining >= 2) {
          await setupBatch(players.slice(i, i + 2));
          i += 2;
        } else {
          await setupBatch(players.slice(i, i + 1));
          i += 1;
        }
      }

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
        `Game created.\n\nGameId: 0x${toHexString(gameId)}\nPlayers: ${playerCount}\nWerewolves: ${werewolfCount}`,
      );
    } catch (e: any) {
      console.error("Create game failed:", e);
      setError(e?.message ?? "Create game failed.");
    } finally {
      setLoading(false);
      setTxTimer({ start: null, elapsed: 0 });
    }
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

        await callWerewolfMethod(
          midnightWallet.contract.werewolf,
          "nightAction",
          [game.gameId, encryptedAction, path, player.sk],
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
    if (nightVotes.length === 0) {
      setError("No night actions recorded.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const target = pickTargetFromVotes(nightVotes, game.players);
      const hasDeath = target !== null && aliveCount(game.players) > 1;
      const targetIdx = target ? target.id : 0;

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
          ? `Night resolved. ${outcome} Game finished.`
          : `Night resolved. Player ${targetIdx} ${
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

        await callWerewolfMethod(midnightWallet.contract.werewolf, "voteDay", [
          game.gameId,
          encryptedVote,
          path,
          player.sk,
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

  const handleResolveDay = async () => {
    setError("");
    setStatus("");
    if (!game || !midnightWallet?.contract?.werewolf) {
      setError("Create a game first.");
      return;
    }
    if (dayVotes.length === 0) {
      setError("No day votes recorded.");
      return;
    }

    setLoading(true);
    setTxTimer({ start: Date.now(), elapsed: 0 });
    try {
      const target = pickTargetFromVotes(dayVotes, game.players);
      const hasElimination = target !== null && aliveCount(game.players) > 1;
      const targetIdx = target ? target.id : 0;

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
          ? `Day resolved. ${outcome} Game finished.`
          : `Day resolved. Player ${targetIdx} ${
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
      await callWerewolfMethod(midnightWallet.contract.werewolf, "forceEndGame", [
        game.gameId,
        game.masterSecret,
      ]);
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
        </div>

        {game && (
          <div className="info">
            <div className="label">Game info</div>
            <div className="mono">
              {`GameId: 0x${toHexString(game.gameId)}\nRound: ${
                game.round
              }\nPhase: ${phaseName(game.phase)}\nPlayers: ${
                game.playerCount
              }\nWerewolves: ${game.werewolfCount}`}
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
                  onChange={(event) => setWerewolfCountInput(event.target.value)}
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
            {game && (
              <div className="form">
                <div className="label">Night phase</div>
                <div className="field">
                  <div className="label">Night action payload (bytes32 hex)</div>
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
                <div className="label">Day phase</div>
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
