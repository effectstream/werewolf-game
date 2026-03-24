import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { loginMidnight } from "./interface.ts";
import { GameChat } from "./components/GameChat.tsx";
import { callWerewolfMethod, connectToContract } from "./contracts/contract.ts";
import { fromHex } from "@midnight-ntwrk/compact-runtime";
import {
  Contract as WerewolfRuntimeContract,
  pureCircuits,
} from "../../../../shared/contracts/midnight/contract-werewolf/src/managed/contract/index.js";
import { BatcherClient } from "../../../../shared/utils/batcher-client.ts";
import { werewolfIdCodec } from "../../../../shared/utils/werewolf-id-codec.ts";
import {
  parseLedgerBytes,
  WerewolfLedger,
} from "../../../../shared/utils/werewolf-ledger.ts";
import { computeRoundActionsDigest } from "../../../../shared/utils/round-actions-digest.ts";
import { convertMidnightLedger } from "../../../../shared/utils/paima-utils.ts";
import nacl from "tweetnacl";
import { useEvmWallet } from "./contexts/EvmWalletContext.tsx";
import { WalletModal } from "./components/WalletModal.tsx";
import { BatcherService } from "./services/batcherService.ts";
import { createWalletClient, custom } from "viem";
import { hardhat } from "viem/chains";

const NODE_API_URL = "http://localhost:9999";
const CHAT_SERVER_HTTP_URL =
  (import.meta.env.VITE_CHAT_SERVER_URL as string | undefined)
    ?.replace(/^ws/, "http") ?? "http://localhost:3001";

// Component to display game ID with human-readable name and hover tooltip
function GameIdDisplay({ gameId }: { gameId: bigint | number }) {
  const readableId = werewolfIdCodec.encode(gameId);
  const rawId = typeof gameId === "bigint"
    ? gameId.toString()
    : gameId.toString();

  return (
    <span
      title={`Raw Game ID: ${rawId}`}
      className="game-id-display"
      style={{
        cursor: "help",
        borderBottom: "1px dotted",
        borderBottomColor: "#888",
      }}
    >
      {readableId}
    </span>
  );
}

// Suppress Effect version mismatch warnings
const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  const message = args.join(" ");
  if (message.includes("Executing an Effect versioned")) {
    return; // Suppress this specific warning
  }
  originalWarn.apply(console, args);
};

const MAX_PLAYERS = 16;

// --- 3-byte vote encryption (matches contract/simulation) ---
const ENCRYPTION_LIMITS = { NUM_MAX: 99, RND_MAX: 99, RAND_MAX: 999 };

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

function unpackData(
  bytes: Uint8Array,
): { target: number; round: number; random: number } {
  const packed = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  const target = (packed >> 17) & 0x7f;
  const round = (packed >> 10) & 0x7f;
  const random = packed & 0x3ff;
  return { target, round, random };
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
  encKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  role: number;
  salt: Uint8Array;
  alive: boolean;
  commitment: Uint8Array;
  leaf: Uint8Array;
  nickname?: string;
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
  gameId: bigint;
  playerId: number;
  leafSecret: Uint8Array;
  merklePath: { sibling: { field: bigint }; goes_left: boolean }[];
  adminVotePublicKeyHex: string;
  role?: number;
  encKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
};

type WitnessSetupData = {
  roleCommitments: Uint8Array[];
  encryptedRoles: Uint8Array[];
  adminKey: { bytes: Uint8Array };
  adminVotePublicKey?: { bytes: Uint8Array };
  initialRoot: { field: bigint };
};

type WitnessActionData = {
  targetNumber: number;
  random: number;
  merklePath: {
    leaf: Uint8Array;
    path: { sibling: { field: bigint }; goes_left: boolean }[];
  };
  leafSecret: Uint8Array;
};

type WitnessPrivateState = {
  setupData: Map<string, WitnessSetupData>;
  nextAction?: WitnessActionData;
  encryptionKeypair?: { secretKey: Uint8Array; publicKey: Uint8Array };
};

type GameState = {
  gameId: bigint;
  masterSecret: Uint8Array;
  masterSecretCommitment: Uint8Array;
  /** Nacl box secret key for admin vote decryption (Curve25519) */
  adminVoteSecretKey: Uint8Array;
  adminVotePublicKeyHex: string;
  adminVotePublicKeyBytes: Uint8Array;
  /** Nacl sign secret key for votes_for_round request signing (Ed25519) */
  adminSignSecretKey: Uint8Array;
  adminSignPublicKeyHex: string;
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

const randomGameId = (): bigint =>
  BigInt(Math.floor(Math.random() * 0x100000000));

const parseGameId = (value: string, label: string): bigint => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing ${label}.`);
  }
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  const parsed = BigInt(trimmed.startsWith("0x") ? `0x${hex}` : trimmed);
  if (parsed < 0n || parsed > 0xffffffffn) {
    throw new Error(`${label} must fit in uint32 (0 to 4294967295).`);
  }
  return parsed;
};

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
      return "LOBBY";
    case Phase.Night:
      return "NIGHT";
    case Phase.Day:
      return "DAY";
    case Phase.Finished:
      return "FINISHED";
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

type TxPhase = "proving" | "batcher" | null;

const FLAVOR_TEXTS = [
  "The village waits in tense silence…",
  "Shadows gather as the proof is sealed…",
  "Ancient cryptographic wards are being woven…",
  "The night conceals its secrets a little longer…",
  "Evidence is being inscribed into the chain…",
  "The wolves deliberate in the dark…",
];

function TxStep(
  { label, hint, status }: {
    label: string;
    hint?: string;
    status: "active" | "done" | "pending";
  },
) {
  return (
    <div className={`tx-step tx-step-${status}`}>
      <div className="tx-step-dot" />
      <div className="tx-step-body">
        <div className="tx-step-label">{label}</div>
        {status === "active" && hint && (
          <div className="tx-step-hint">{hint}</div>
        )}
      </div>
    </div>
  );
}

function TxProgressStepper(
  { phase, elapsed }: { phase: TxPhase; elapsed: number },
) {
  const flavorIdx = Math.floor(elapsed / 15) % FLAVOR_TEXTS.length;
  const showReassurance = elapsed >= 45;

  const provingStatus = phase === "proving"
    ? "active"
    : phase === "batcher"
    ? "done"
    : "pending";
  const batcherStatus = phase === "batcher" ? "active" : "pending";

  return (
    <div className="tx-progress">
      <div className="tx-steps">
        <TxStep
          label="Generating ZK Proof"
          hint="~1–3 minutes"
          status={provingStatus as "active" | "done" | "pending"}
        />
        <div className="tx-step-connector" />
        <TxStep
          label="Submitting to Batcher"
          hint="~20–30 seconds"
          status={batcherStatus as "active" | "pending"}
        />
        <div className="tx-step-connector" />
        <TxStep label="Done" status="pending" />
      </div>
      <div className="tx-elapsed">{elapsed}s elapsed</div>
      <div className="tx-flavor">{FLAVOR_TEXTS[flavorIdx]}</div>
      {showReassurance && (
        <div className="tx-reassurance">
          Still working — this is normal for ZK transactions.
        </div>
      )}
    </div>
  );
}

function TxProgressModal(
  { phase, elapsed }: { phase: TxPhase; elapsed: number },
) {
  return (
    <div className="tx-modal-overlay">
      <div className="tx-modal-card">
        <div className="tx-modal-title">Processing Transaction</div>
        <TxProgressStepper phase={phase} elapsed={elapsed} />
      </div>
    </div>
  );
}

function App() {
  const [loading, setLoading] = useState(false);
  const [txPhase, setTxPhase] = useState<TxPhase>(null);
  const [midnightWallet, setMidnightWallet] = useState<any>(null);
  const [midnightProviders, setMidnightProviders] = useState<any>(null);
  const [midnightAddress, setMidnightAddress] = useState("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  // EVM wallet integration
  const {
    isConnected: evmConnected,
    address: evmAddress,
    wallet: evmWallet,
    isModalOpen,
    openModal,
    closeModal,
  } = useEvmWallet();
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
  const [nightVoteInputs, setNightVoteInputs] = useState<string[]>([]);
  const [dayVoteInputs, setDayVoteInputs] = useState<string[]>([]);
  const [nightEliminationInput, setNightEliminationInput] = useState("0");
  const [dayEliminationInput, setDayEliminationInput] = useState("0");
  const [copied, setCopied] = useState(false);
  const [chatRoomReady, setChatRoomReady] = useState(false);
  // Voter indices who have submitted votes in the current round/phase
  const [votedPlayerIndices, setVotedPlayerIndices] = useState<number[]>([]);
  // Track which round:phase keys we have already auto-submitted to avoid double submission
  // Using a ref so the polling interval does not need to be recreated on each update
  const autoSubmittedKeysRef = useRef<Set<string>>(new Set());
  // Progress while the auto-submit loop is sending votes to the contract one-by-one
  const [submitProgress, setSubmitProgress] = useState<
    {
      done: number;
      total: number;
    } | null
  >(null);
  // Decrypted vote breakdown for the current round (voter → target)
  const [voteTally, setVoteTally] = useState<
    { voter: number; target: number }[]
  >([]);
  // Human-readable outcome of the last resolved round
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);
  // Store player nicknames from the API
  const [playerNicknames, setPlayerNicknames] = useState<Map<number, string>>(
    new Map(),
  );
  // Track received votes for display (voter index -> target index)
  const [receivedVotes, setReceivedVotes] = useState<Map<number, number>>(
    new Map(),
  );

  // Helper function to get player display name (nickname or "Player X")
  const getPlayerName = (playerId: number): string => {
    const nickname = playerNicknames.get(playerId);
    return nickname || `Player ${playerId}`;
  };

  const runtimeWitnesses = useMemo(
    () => ({
      wit_getRoleCommitment: (
        _: unknown,
        gameId: number | bigint,
        n: number | bigint,
      ) => {
        const id = String(gameId);
        throw new Error(
          `Witness not configured in frontend (role commitment ${n} for ${id}).`,
        );
      },
      wit_getEncryptedRole: (
        _: unknown,
        gameId: number | bigint,
        n: number | bigint,
      ) => {
        const id = String(gameId);
        throw new Error(
          `Witness not configured in frontend (encrypted role ${n} for ${id}).`,
        );
      },
      wit_getInitialRoot: (_: unknown, gameId: number | bigint) => {
        const id = String(gameId);
        throw new Error(
          `Witness not configured in frontend (initial root for ${id}).`,
        );
      },
      wit_getActionData: (
        _: unknown,
        gameId: number | bigint,
        round: number | bigint,
      ) => {
        const id = String(gameId);
        throw new Error(
          `Witness not configured in frontend (action for ${id} round ${round}).`,
        );
      },
    }),
    [],
  );

  const runtimeContract = useMemo(
    () => new WerewolfRuntimeContract(runtimeWitnesses),
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
        gameId: game.gameId.toString(),
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

  // Auto-reset txPhase when the transaction timer stops
  useEffect(() => {
    if (txTimer.start === null) {
      setTxPhase(null);
    }
  }, [txTimer.start]);

  // Starts a timed transaction: resets the timer and enters the proof generation phase
  const startTx = () => {
    setTxPhase("proving");
    setTxTimer({ start: Date.now(), elapsed: 0 });
  };

  const fetchPlayerNicknames = async (gameId: bigint) => {
    try {
      const res = await fetch(
        `${NODE_API_URL}/api/game_players?gameId=${gameId}`,
      );
      if (!res.ok) return;
      const data = await res.json() as {
        players: { playerId: number; nickname: string }[];
      };
      const nicknameMap = new Map<number, string>();
      for (const p of data.players) {
        if (p.playerId !== undefined && p.nickname) {
          nicknameMap.set(p.playerId, p.nickname);
        }
      }
      setPlayerNicknames(nicknameMap);
    } catch (err) {
      console.error("Failed to fetch player nicknames:", err);
    }
  };

  // Poll /api/vote_status every 6 seconds. When all alive players have submitted
  // encrypted votes, fetch them, decrypt each with adminVoteSecretKey + player's
  // encKeypair.publicKey, then stage + submit each via the batcher (nightAction /
  // voteDay). This mirrors handleSubmitNightActions / handleSubmitDayVotes but uses
  // the player-submitted targets from the DB instead of manual UI inputs.
  useEffect(() => {
    if (
      !game || game.phase === Phase.Finished ||
      !midnightWallet?.contract?.werewolf
    ) {
      return;
    }

    const phaseStr = game.phase === Phase.Night ? "NIGHT" : "DAY";
    const pollKey = `${game.gameId}:${game.round}:${phaseStr}`;

    // Fetch player nicknames when game changes
    void fetchPlayerNicknames(game.gameId);

    // Clear per-round state when entering a new round/phase
    setVotedPlayerIndices([]);
    setVoteTally([]);
    setReceivedVotes(new Map());
    setSubmitProgress(null);
    setLastOutcome(null);

    const poll = async () => {
      try {
        // Always fetch current votes so the UI stays up to date.
        // Sign the request with the admin Ed25519 signing key so the server can
        // authenticate the moderator before returning sensitive vote data.
        const pollTimestamp = Math.floor(Date.now() / 1000);
        const pollMsg = new TextEncoder().encode(
          `${game.round}:${phaseStr}:${pollTimestamp}`,
        );
        const pollSig = nacl.sign.detached(pollMsg, game.adminSignSecretKey);
        const pollSigHex = bytesToHex(pollSig);
        const votesRes = await fetch(
          `${NODE_API_URL}/api/votes_for_round?gameId=${game.gameId}&round=${game.round}&phase=${
            encodeURIComponent(phaseStr)
          }&timestamp=${pollTimestamp}&signature=${pollSigHex}`,
        );
        if (!votesRes.ok) {
          if (votesRes.status === 403) {
            console.warn(
              "[poll] votes_for_round returned 403 — signature invalid or timestamp expired.",
            );
          }
          return;
        }
        const { votes } = await votesRes.json() as {
          votes: {
            voterIndex: number;
            encryptedVoteHex: string;
            merklePathJson: string;
          }[];
        };

        // Update which players have voted so the UI can show it
        setVotedPlayerIndices(votes.map((v) => v.voterIndex));

        // Decrypt and display votes as they come in (even before all votes are in)
        const receivedVotesMap = new Map<number, number>();
        for (const vote of votes) {
          const player = game.players.find((p) => p.id === vote.voterIndex);
          if (!player || !player.alive) continue;

          // Decrypt the vote to show target
          const cipherHex = vote.encryptedVoteHex.startsWith("0x")
            ? vote.encryptedVoteHex.slice(2)
            : vote.encryptedVoteHex;
          const cipherBytes = new Uint8Array(
            cipherHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16)),
          );
          // Derive the player's Curve25519 public key from their leafSecret (sk).
          // voteService.ts uses sk directly as the private key, so scalarMult.base(sk)
          // gives the matching public key for the Diffie-Hellman shared-secret derivation.
          const sessionKey = deriveSessionKey(
            game.adminVoteSecretKey,
            nacl.scalarMult.base(player.sk),
            game.round,
          );
          const plaintext = xorPayload(cipherBytes.slice(0, 3), sessionKey);
          const { target: targetIdx, round: voteRound } = unpackData(plaintext);

          if (voteRound === game.round) {
            receivedVotesMap.set(vote.voterIndex, targetIdx);
          }
        }
        setReceivedVotes(receivedVotesMap);

        // Only auto-submit once per round/phase when all alive players have voted
        if (autoSubmittedKeysRef.current.has(pollKey)) return;

        const alivePlayerCount = game.players.filter((p) => p.alive).length;
        if (alivePlayerCount === 0 || votes.length < alivePlayerCount) return;

        // Mark as submitted before async work to prevent race conditions
        autoSubmittedKeysRef.current.add(pollKey);

        console.log(
          `[autoVote] All ${votes.length}/${alivePlayerCount} votes in for ${phaseStr} round ${game.round}. Fetching and submitting.`,
        );

        const targets: number[] = [];
        const tallyEntries: { voter: number; target: number }[] = [];
        const batcherClient = getBatcherClient();

        // Determine how many valid votes we'll process for the progress indicator
        const validVoteCount = votes.filter((v) =>
          game.players.find((p) =>
            p.id === v.voterIndex && p.alive
          )
        ).length;
        setSubmitProgress({ done: 0, total: validVoteCount });

        for (const vote of votes) {
          const player = game.players.find((p) => p.id === vote.voterIndex);
          if (!player || !player.alive) continue;

          // Decrypt the stored encrypted vote to recover the target index
          const cipherHex = vote.encryptedVoteHex.startsWith("0x")
            ? vote.encryptedVoteHex.slice(2)
            : vote.encryptedVoteHex;
          const cipherBytes = new Uint8Array(
            cipherHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16)),
          );
          // Derive the player's Curve25519 public key from their leafSecret (sk).
          // voteService.ts uses sk directly as the private key, so scalarMult.base(sk)
          // gives the matching public key for the Diffie-Hellman shared-secret derivation.
          const sessionKey = deriveSessionKey(
            game.adminVoteSecretKey,
            nacl.scalarMult.base(player.sk),
            game.round,
          );
          const plaintext = xorPayload(cipherBytes.slice(0, 3), sessionKey);
          const { target: targetIdx, round: voteRound } = unpackData(plaintext);

          if (voteRound !== game.round) {
            console.warn(
              `[autoVote] Vote round mismatch: expected ${game.round}, got ${voteRound}`,
            );
            continue;
          }

          const path = game.tree.getProof(player.id, player.leaf);
          await stageNextAction(
            game.gameId,
            {
              targetNumber: targetIdx,
              random: Math.floor(Math.random() * 1000),
              merklePath: path,
              leafSecret: player.sk,
            },
            player.encKeypair,
            game.adminVotePublicKeyBytes,
          );

          if (game.phase === Phase.Night) {
            await batcherClient.nightAction(game.gameId);
          } else {
            await batcherClient.voteDay(game.gameId);
          }

          targets.push(targetIdx);
          tallyEntries.push({ voter: vote.voterIndex, target: targetIdx });
          setSubmitProgress({
            done: tallyEntries.length,
            total: validVoteCount,
          });
        }

        setVoteTally(tallyEntries);
        setSubmitProgress(null);

        if (game.phase === Phase.Night) {
          setNightVotes(targets);
          setStatus(
            `[Auto] Night actions submitted for ${targets.length} players.`,
          );
        } else {
          setDayVotes(targets);
          setStatus(
            `[Auto] Day votes submitted for ${targets.length} players.`,
          );
        }

        // Auto-resolve: wait briefly for ledger to settle then resolve the phase
        if (targets.length > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));

          const isNight = game.phase === Phase.Night;
          const result = resolveVotes(targets, game.players, isNight);
          const hasDeath = result.hasElimination &&
            aliveCount(game.players) > 1;
          const resolvedTargetIdx = result.targetIdx;

          // Fetch latest ledger to compute real digest from on-chain submissions
          const resolveState = midnightProviders
            ? await refreshLedgerState()
            : ledgerState;
          const autoRoundActionsDigest = resolveState
            ? buildDigestFromLedgerState(
              resolveState,
              game.gameId,
              game.round,
              isNight,
            )
            : new Uint8Array(32);

          if (isNight) {
            await batcherClient.resolveNight(
              game.gameId,
              BigInt(game.round + 1),
              BigInt(resolvedTargetIdx),
              hasDeath,
              game.tree.getRoot(),
              autoRoundActionsDigest,
            );
            const nextPlayers = game.players.map((p) =>
              hasDeath && p.id === resolvedTargetIdx
                ? { ...p, alive: false }
                : p
            );
            const outcome = getOutcome(nextPlayers);
            setGame((prev) => {
              if (
                !prev || prev.round !== game.round || prev.phase !== game.phase
              ) return prev;
              return {
                ...prev,
                players: nextPlayers,
                phase: outcome ? Phase.Finished : Phase.Day,
              };
            });
            setNightVotes([]);
            setLastOutcome(
              `Night ${game.round}: ${getPlayerName(resolvedTargetIdx)} ${
                hasDeath ? "died" : "survived"
              } — ${result.info}`,
            );
            setStatus(
              outcome
                ? `[Auto] Night resolved. ${result.info} ${outcome} Game finished.`
                : `[Auto] Night resolved. ${result.info} ${
                  getPlayerName(resolvedTargetIdx)
                } ${hasDeath ? "died" : "survived"}.`,
            );
          } else {
            await batcherClient.resolveDay(
              game.gameId,
              BigInt(resolvedTargetIdx),
              hasDeath,
              autoRoundActionsDigest,
            );
            const nextPlayers = game.players.map((p) =>
              hasDeath && p.id === resolvedTargetIdx
                ? { ...p, alive: false }
                : p
            );
            const outcome = getOutcome(nextPlayers);
            setGame((prev) => {
              if (
                !prev || prev.round !== game.round || prev.phase !== game.phase
              ) return prev;
              return {
                ...prev,
                players: nextPlayers,
                round: prev.round + 1,
                phase: outcome ? Phase.Finished : Phase.Night,
              };
            });
            setDayVotes([]);
            setLastOutcome(
              `Day ${game.round}: ${getPlayerName(resolvedTargetIdx)} ${
                hasDeath ? "eliminated" : "survived"
              } — ${result.info}`,
            );
            setStatus(
              outcome
                ? `[Auto] Day resolved. ${result.info} ${outcome} Game finished.`
                : `[Auto] Day resolved. ${result.info} ${
                  getPlayerName(resolvedTargetIdx)
                } ${hasDeath ? "eliminated" : "survived"}.`,
            );
          }
        }
      } catch (err: any) {
        console.error("[autoVote] Failed:", err);
      }
    };

    const intervalId = globalThis.setInterval(poll, 6000);
    return () => globalThis.clearInterval(intervalId);
  }, [
    game?.gameId,
    game?.round,
    game?.phase,
    midnightWallet?.contract?.werewolf,
  ]);

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
      gameId: parseGameId(bundle.gameId, "gameId"),
      playerId: bundle.playerId,
      leafSecret: parseBytes32(bundle.leafSecret, "leafSecret"),
      merklePath,
      adminVotePublicKeyHex: bundle.adminVotePublicKeyHex,
      role: bundle.role,
      encKeypair: nacl.box.keyPair(),
    };
  };

  const parseOptionalIndex = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const clampIndex = (value: number, max: number) =>
    Math.max(0, Math.min(max, value));

  const normalizeVoteInputs = (inputs: string[], count: number) => {
    const next = [...inputs];
    while (next.length < count) next.push("0");
    return next.slice(0, count);
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
    gameId: bigint,
    adminKeyBytes: Uint8Array,
    adminVotePublicKeyBytes: Uint8Array,
    commitments: Uint8Array[],
    initialRoot: { field: bigint },
  ) => {
    if (!midnightProviders?.privateStateProvider?.set) {
      throw new Error("Private state provider not available.");
    }
    const roleCommitments = [...commitments];
    while (roleCommitments.length < MAX_PLAYERS) {
      roleCommitments.push(new Uint8Array(32));
    }
    const encryptedRoles = Array.from(
      { length: MAX_PLAYERS },
      () => new Uint8Array(3),
    );
    const key = String(gameId);
    const state: WitnessPrivateState = {
      setupData: new Map([[
        key,
        {
          roleCommitments,
          encryptedRoles,
          adminKey: { bytes: adminKeyBytes },
          adminVotePublicKey: { bytes: adminVotePublicKeyBytes },
          initialRoot,
        },
      ]]),
      nextAction: undefined,
    };
    await midnightProviders.privateStateProvider.set(
      "werewolfPrivateState",
      state,
    );
  };

  const stageNextAction = async (
    gameId: bigint,
    action: WitnessActionData,
    encryptionKeypair: { secretKey: Uint8Array; publicKey: Uint8Array },
    adminVotePublicKeyBytes: Uint8Array,
  ) => {
    if (!midnightProviders?.privateStateProvider?.set) {
      throw new Error("Private state provider not available.");
    }
    const key = String(gameId);
    const state: WitnessPrivateState = {
      setupData: new Map([[
        key,
        {
          roleCommitments: Array.from(
            { length: MAX_PLAYERS },
            () => new Uint8Array(32),
          ),
          encryptedRoles: Array.from(
            { length: MAX_PLAYERS },
            () => new Uint8Array(3),
          ),
          adminKey: { bytes: new Uint8Array(32) },
          adminVotePublicKey: { bytes: adminVotePublicKeyBytes },
          initialRoot: { field: 0n },
        },
      ]]),
      nextAction: action,
      encryptionKeypair,
    };
    await midnightProviders.privateStateProvider.set(
      "werewolfPrivateState",
      state,
    );
  };

  const getEncryptedVotesFromLedger = (
    state: unknown,
    gameId: bigint,
    phase: number,
    round: number,
  ): Uint8Array[] => {
    const converted = convertMidnightLedger(state);
    const werewolfLedger = WerewolfLedger.from(converted);
    const entries = werewolfLedger.getVoteEntriesForRoundAndPhase(
      Number(gameId),
      round,
      phase,
    );
    return entries.map((entry) => parseLedgerBytes(entry.encryptedVote, 3));
  };

  const buildDigestFromLedgerState = (
    state: unknown,
    gameId: bigint,
    round: number,
    isNight: boolean,
  ): Uint8Array => {
    const converted = convertMidnightLedger(state);
    const werewolfLedger = WerewolfLedger.from(converted);
    const phase = isNight ? Phase.Night : Phase.Day;
    const entries = werewolfLedger.getVoteEntriesForRoundAndPhase(
      Number(gameId),
      round,
      phase,
    );
    return computeRoundActionsDigest(
      gameId,
      round,
      phase,
      entries.map((entry) => ({
        nullifier: entry.key.nullifier,
        encryptedAction: parseLedgerBytes(entry.encryptedVote, 3),
      })),
    );
  };

  const decryptVoteTargets = (
    encryptedVotes: Uint8Array[],
    adminVoteSecretKey: Uint8Array,
    playerPublicKeys: Map<number, Uint8Array>,
    round: number,
    isNight: boolean,
    werewolfIndices: number[],
  ): number[] => {
    const targets: number[] = [];
    for (let i = 0; i < encryptedVotes.length; i++) {
      const enc = encryptedVotes[i];
      if (!enc || enc.length < 3 || isZeroBytes(enc)) continue;
      const ciphertext = enc.slice(0, 3);
      let found = false;
      for (const [playerId, playerPubKey] of playerPublicKeys.entries()) {
        if (isNight && !werewolfIndices.includes(playerId)) continue;
        try {
          const sessionKey = deriveSessionKey(
            adminVoteSecretKey,
            playerPubKey,
            round,
          );
          const plaintext = xorPayload(ciphertext, sessionKey);
          const data = unpackData(plaintext);
          if (data.round === round) {
            targets.push(data.target);
            found = true;
            break;
          }
        } catch {
          // try next key
        }
      }
      if (!found) {
        console.warn(`Undecryptable vote at index ${i}`);
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

  const getBatcherClient = () => {
    if (
      !midnightWallet?.contract?.werewolf || !midnightProviders?.walletProvider
    ) {
      throw new Error("Midnight wallet or providers not ready.");
    }
    // Transition to batcher phase when inside a timed transaction
    if (txTimer.start !== null) {
      setTxPhase("batcher");
    }
    return new BatcherClient(
      midnightWallet.contract.werewolf,
      midnightProviders.walletProvider,
    );
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
    if (!evmConnected || !evmAddress) {
      setError("Connect EVM wallet first.");
      return;
    }

    setLoading(true);
    startTx();
    try {
      const playerCount = Math.min(
        MAX_PLAYERS,
        Math.max(2, parseCount(playerCountInput, 5)),
      );
      const werewolfCount = Math.min(
        Math.max(1, parseCount(werewolfCountInput, 1)),
        playerCount - 1,
      );

      if (playerCount < 5) {
        throw new Error("Minimum 5 players required.");
      }
      if (werewolfCount < 2) {
        throw new Error("Minimum 2 werewolves required.");
      }

      const adminKeyBytes = getAdminKeyBytes();
      const gameId = randomGameId();
      const adminVoteKeypair = nacl.box.keyPair();
      const adminVotePublicKeyBytes = new Uint8Array(33);
      adminVotePublicKeyBytes.set(adminVoteKeypair.publicKey);
      const adminVotePublicKeyHex = bytesToHex(adminVotePublicKeyBytes);
      // Separate Ed25519 signing keypair for authenticating votes_for_round requests.
      // Must NOT use adminVoteKeypair (Curve25519) with nacl.sign — incompatible key types.
      const adminSignKeypair = nacl.sign.keyPair();
      const adminSignPublicKeyHex = bytesToHex(adminSignKeypair.publicKey);
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
        const encKeypair = nacl.box.keyPair();
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
          encKeypair,
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

      // Compute player bundles inline so they can be sent to the Node API
      // immediately, before setGame() is called (which would update the useMemo).
      const bundlesToSend: PlayerBundle[] = players.map((player) => {
        const proof = tree.getProof(player.id, player.leaf);
        return {
          gameId: gameId.toString(),
          playerId: player.id,
          leafSecret: bytesToHex(player.sk),
          merklePath: proof.path.map((entry) => ({
            sibling: { field: entry.sibling.field.toString() },
            goes_left: entry.goes_left,
          })),
          adminVotePublicKeyHex,
          role: player.role,
        } satisfies PlayerBundle;
      });

      // --- Pretty Logging for Game Setup ---
      console.group("🎲 Game Setup Details");
      console.log("Game ID:", gameId.toString());
      console.log("Game Phrase:", werewolfIdCodec.encode(gameId));
      console.log(
        "Master Secret Commitment:",
        bytesToHex(masterSecretCommitment),
      );
      console.log(
        "Merkle Tree Root:",
        bytesToHex(
          new Uint8Array(
            pureCircuits.testComputeHash(
              fromHex(initialRoot.field.toString(16).padStart(64, "0")),
            ),
          ),
        ),
      ); // Actually the root field itself is more useful
      console.log("Merkle Tree Root Field:", initialRoot.field.toString());

      const playerLogs = players.map((p) => ({
        ID: p.id,
        Role: roleName(p.role),
        "Public Key": bytesToHex(p.pk).slice(0, 10) + "...",
        "Secret Key": bytesToHex(p.sk).slice(0, 10) + "...",
        "Enc PubKey": bytesToHex(p.encKeypair.publicKey).slice(0, 10) + "...",
        Commitment: bytesToHex(p.commitment).slice(0, 10) + "...",
        Leaf: bytesToHex(p.leaf).slice(0, 10) + "...",
      }));
      console.table(playerLogs);
      console.groupEnd();

      await stageSetupData(
        gameId,
        adminKeyBytes,
        adminVotePublicKeyBytes,
        players.map((p) => p.commitment),
        initialRoot,
      );

      setStatus("Creating game (via batcher)…");

      const batcherClient = getBatcherClient();
      await batcherClient.createGame(
        gameId,
        adminVotePublicKeyBytes,
        masterSecretCommitment,
        BigInt(playerCount),
        BigInt(werewolfCount),
      );

      // Create an EIP-1193 compatible wrapper for the Paima wallet provider.
      const providerConnection = evmWallet?.provider.getConnection() as {
        api: {
          request: (args: { method: string; params?: any[] }) => Promise<any>;
        };
      } | undefined;
      console.log("Provider connection:", providerConnection);

      if (!providerConnection) {
        throw new Error(
          "EVM wallet provider not available. Please reconnect your wallet.",
        );
      }

      const evmProvider = {
        request: async (
          { method, params }: { method: string; params?: any[] },
        ) => {
          console.log("EIP-1193 request:", method, params);
          return await providerConnection.api.request({ method, params });
        },
      };

      const walletApiClient = createWalletClient({
        account: evmAddress as `0x${string}`,
        chain: hardhat,
        transport: custom(evmProvider),
      });

      setStatus("Registering game with backend…");
      const apiResponse = await fetch(
        `${NODE_API_URL}/api/create_game`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: gameId.toString(),
            maxPlayers: playerCount,
            adminSignPublicKeyHex,
            playerBundles: bundlesToSend,
          }),
        },
      );

      if (!apiResponse.ok) {
        throw new Error(
          `API registration failed: ${apiResponse.status} ${apiResponse.statusText}`,
        );
      }

      const apiData = await apiResponse.json();
      console.log("API Response:", apiData);

      // Create game on EVM chain via batcher (paimaL2 target)
      setStatus("Creating game on EVM chain via batcher…");

      // Send to batcher with target "paimaL2"
      await BatcherService.createGame(
        evmAddress,
        gameId,
        playerCount,
        ({ message }) =>
          walletApiClient.signMessage({ message: message as any }),
      );

      console.log("Game created on EVM chain via batcher");

      // Pre-invite the moderator (trusted node) into the game chat room.
      // Must succeed before <GameChat> is mounted — we gate on chatRoomReady.
      setStatus("Creating chat room…");
      const chatRes = await fetch(`${CHAT_SERVER_HTTP_URL}/create-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: Number(gameId),
          moderatorHash: midnightAddress,
        }),
      });
      if (!chatRes.ok) {
        throw new Error(
          `Chat server error: ${chatRes.status} ${await chatRes.text()}`,
        );
      }
      setChatRoomReady(true);

      setGame({
        gameId,
        masterSecret,
        masterSecretCommitment,
        adminVoteSecretKey: adminVoteKeypair.secretKey,
        adminVotePublicKeyHex,
        adminVotePublicKeyBytes,
        adminSignSecretKey: adminSignKeypair.secretKey,
        adminSignPublicKeyHex,
        players,
        tree,
        round: 1,
        phase: Phase.Night,
        playerCount,
        werewolfCount,
      });
      setNightVotes([]);
      setDayVotes([]);
      setNightVoteInputs(
        Array.from({ length: playerCount }, () => "0"),
      );
      setDayVoteInputs(
        Array.from({ length: playerCount }, () => "0"),
      );
      setNightEliminationInput("0");
      setDayEliminationInput("0");
      setRevealPlayerIdx(0);
      setStatus(
        `Game created successfully.

GameId: ${werewolfIdCodec.encode(gameId)}
Players: ${playerCount}
Werewolves: ${werewolfCount}
Midnight: ✅
EVM: ✅`,
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
        `Loaded player ${profile.playerId} (game ${profile.gameId}).`,
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
    startTx();
    try {
      const targets: number[] = [];
      let lastEncryptedHex = "";
      const voteInputs = normalizeVoteInputs(
        nightVoteInputs,
        game.players.length,
      );
      setNightVoteInputs(voteInputs);
      for (const player of game.players) {
        if (!player.alive) continue;
        const rawTarget = parseOptionalIndex(voteInputs[player.id]);
        const fallback = pickRandomAliveNonWerewolf(game.players) ??
          pickRandomAlive(game.players);
        const targetIdx = rawTarget == null
          ? (fallback ? fallback.id : 0)
          : clampIndex(rawTarget, game.players.length - 1);
        const payloadBytes = nightActionPayloadInput.trim()
          ? parseBytes32(nightActionPayloadInput, "Night action payload")
          : encodeVoteTarget(targetIdx);
        lastEncryptedHex = "";
        const path = game.tree.getProof(player.id, player.leaf);

        await stageNextAction(
          game.gameId,
          {
            targetNumber: decodeVoteTarget(payloadBytes),
            random: Math.floor(Math.random() * 1000),
            merklePath: path,
            leafSecret: player.sk,
          },
          player.encKeypair,
          game.adminVotePublicKeyBytes,
        );
        const batcherClient = getBatcherClient();
        await batcherClient.nightAction(game.gameId);
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
    startTx();
    try {
      const manualTarget = parseOptionalIndex(nightEliminationInput);
      if (manualTarget != null) {
        const targetIdx = clampIndex(manualTarget, game.players.length - 1);
        const hasDeath = aliveCount(game.players) > 1 &&
          game.players[targetIdx]?.alive;

        const latestStateForDigest = midnightProviders
          ? await refreshLedgerState()
          : ledgerState;
        const roundActionsDigest = latestStateForDigest
          ? buildDigestFromLedgerState(
            latestStateForDigest,
            game.gameId,
            game.round,
            true,
          )
          : new Uint8Array(32);

        const batcherClient = getBatcherClient();
        await batcherClient.resolveNight(
          game.gameId,
          BigInt(game.round + 1),
          BigInt(targetIdx),
          hasDeath,
          game.tree.getRoot(),
          roundActionsDigest,
        );

        const nextPlayers = game.players.map((p) =>
          hasDeath && p.id === targetIdx ? { ...p, alive: false } : p
        );
        const outcome = getOutcome(nextPlayers);

        setGame({
          ...game,
          players: nextPlayers,
          phase: outcome ? Phase.Finished : Phase.Day,
        });
        setNightVotes([]);
        setLastOutcome(
          `Night ${game.round}: ${getPlayerName(targetIdx)} ${
            hasDeath ? "died" : "survived"
          } — Trusted node override.`,
        );
        setStatus(
          outcome
            ? `Night resolved. Trusted node eliminated ${
              getPlayerName(targetIdx)
            }. ${outcome}`
            : `Night resolved. Trusted node eliminated ${
              getPlayerName(targetIdx)
            }.`,
        );
        return;
      }

      const latestLedgerState = midnightProviders
        ? await refreshLedgerState()
        : ledgerState;
      if (!latestLedgerState) {
        throw new Error(
          "Ledger state unavailable. Refresh ledger state first.",
        );
      }
      const encryptedVotes = getEncryptedVotesFromLedger(
        latestLedgerState,
        game.gameId,
        Phase.Night,
        game.round,
      );
      const werewolfIndices = game.players
        .filter((p) => p.role === Role.Werewolf)
        .map((p) => p.id);
      const playerPubKeys = new Map(
        game.players.map((p) => [p.id, p.encKeypair.publicKey]),
      );
      const voteTargets = decryptVoteTargets(
        encryptedVotes,
        game.adminVoteSecretKey,
        playerPubKeys,
        game.round,
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

      const roundActionsDigestNight = buildDigestFromLedgerState(
        latestLedgerState,
        game.gameId,
        game.round,
        true,
      );
      const batcherClient = getBatcherClient();
      await batcherClient.resolveNight(
        game.gameId,
        BigInt(game.round + 1),
        BigInt(targetIdx),
        hasDeath,
        game.tree.getRoot(),
        roundActionsDigestNight,
      );

      const nextPlayers = game.players.map((p) =>
        hasDeath && p.id === targetIdx ? { ...p, alive: false } : p
      );
      const outcome = getOutcome(nextPlayers);

      setGame({
        ...game,
        players: nextPlayers,
        phase: outcome ? Phase.Finished : Phase.Day,
      });
      setNightVotes([]);
      setLastOutcome(
        `Night ${game.round}: ${getPlayerName(targetIdx)} ${
          hasDeath ? "died" : "survived"
        } — ${result.info}`,
      );
      setStatus(
        outcome
          ? `Night resolved. ${result.info} ${outcome} Game finished.`
          : `Night resolved. ${result.info} ${getPlayerName(targetIdx)} ${
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
    startTx();
    try {
      const targets: number[] = [];
      let lastEncryptedHex = "";
      const voteInputs = normalizeVoteInputs(
        dayVoteInputs,
        game.players.length,
      );
      setDayVoteInputs(voteInputs);
      for (const player of game.players) {
        if (!player.alive) continue;
        const rawTarget = parseOptionalIndex(voteInputs[player.id]);
        const fallback = pickRandomAlive(game.players);
        const targetIdx = rawTarget == null
          ? (fallback ? fallback.id : 0)
          : clampIndex(rawTarget, game.players.length - 1);
        const payloadBytes = dayVotePayloadInput.trim()
          ? parseBytes32(dayVotePayloadInput, "Day vote payload")
          : encodeVoteTarget(targetIdx);
        lastEncryptedHex = "";
        const path = game.tree.getProof(player.id, player.leaf);

        await stageNextAction(
          game.gameId,
          {
            targetNumber: decodeVoteTarget(payloadBytes),
            random: Math.floor(Math.random() * 1000),
            merklePath: path,
            leafSecret: player.sk,
          },
          player.encKeypair,
          game.adminVotePublicKeyBytes,
        );
        const batcherClient = getBatcherClient();
        await batcherClient.voteDay(game.gameId);
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
    startTx();
    try {
      const payloadBytes = playerNightPayloadInput.trim()
        ? parseBytes32(playerNightPayloadInput, "Night action payload")
        : encodeVoteTarget(parseCount(playerTargetIdxInput, 0));
      const leaf = new Uint8Array(
        (pureCircuits as any).testComputeHash(playerProfile.leafSecret),
      );
      const path = { leaf, path: playerProfile.merklePath };

      await stageNextAction(
        playerProfile.gameId,
        {
          targetNumber: decodeVoteTarget(payloadBytes),
          random: Math.floor(Math.random() * 1000),
          merklePath: path,
          leafSecret: playerProfile.leafSecret,
        },
        playerProfile.encKeypair,
        hexToBytes(playerProfile.adminVotePublicKeyHex),
      );
      const batcherClient = getBatcherClient();
      await batcherClient.nightAction(playerProfile.gameId);

      setPlayerLastEncryptedHex("");
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
    startTx();
    try {
      const payloadBytes = playerDayPayloadInput.trim()
        ? parseBytes32(playerDayPayloadInput, "Day vote payload")
        : encodeVoteTarget(parseCount(playerTargetIdxInput, 0));
      const leaf = new Uint8Array(
        (pureCircuits as any).testComputeHash(playerProfile.leafSecret),
      );
      const path = { leaf, path: playerProfile.merklePath };

      await stageNextAction(
        playerProfile.gameId,
        {
          targetNumber: decodeVoteTarget(payloadBytes),
          random: Math.floor(Math.random() * 1000),
          merklePath: path,
          leafSecret: playerProfile.leafSecret,
        },
        playerProfile.encKeypair,
        hexToBytes(playerProfile.adminVotePublicKeyHex),
      );
      const batcherClient = getBatcherClient();
      await batcherClient.voteDay(playerProfile.gameId);

      setPlayerLastEncryptedHex("");
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
    startTx();
    try {
      const manualTarget = parseOptionalIndex(dayEliminationInput);
      if (manualTarget != null) {
        const targetIdx = clampIndex(manualTarget, game.players.length - 1);
        const hasElimination = aliveCount(game.players) > 1 &&
          game.players[targetIdx]?.alive;

        const latestStateForDigest = midnightProviders
          ? await refreshLedgerState()
          : ledgerState;
        const roundActionsDigest = latestStateForDigest
          ? buildDigestFromLedgerState(
            latestStateForDigest,
            game.gameId,
            game.round,
            false,
          )
          : new Uint8Array(32);

        const batcherClient = getBatcherClient();
        await batcherClient.resolveDay(
          game.gameId,
          BigInt(targetIdx),
          hasElimination,
          roundActionsDigest,
        );

        const nextPlayers = game.players.map((p) =>
          hasElimination && p.id === targetIdx ? { ...p, alive: false } : p
        );
        const outcome = getOutcome(nextPlayers);

        setGame({
          ...game,
          players: nextPlayers,
          round: game.round + 1,
          phase: outcome ? Phase.Finished : Phase.Night,
        });
        setDayVotes([]);
        setLastOutcome(
          `Day ${game.round}: ${getPlayerName(targetIdx)} ${
            hasElimination ? "eliminated" : "survived"
          } — Trusted node override.`,
        );
        setStatus(
          outcome
            ? `Day resolved. Trusted node eliminated ${
              getPlayerName(targetIdx)
            }. ${outcome}`
            : `Day resolved. Trusted node eliminated ${
              getPlayerName(targetIdx)
            }.`,
        );
        return;
      }

      const latestLedgerState = midnightProviders
        ? await refreshLedgerState()
        : ledgerState;
      if (!latestLedgerState) {
        throw new Error(
          "Ledger state unavailable. Refresh ledger state first.",
        );
      }
      const encryptedVotes = getEncryptedVotesFromLedger(
        latestLedgerState,
        game.gameId,
        Phase.Day,
        game.round,
      );
      const playerPubKeys = new Map(
        game.players.map((p) => [p.id, p.encKeypair.publicKey]),
      );
      const voteTargets = decryptVoteTargets(
        encryptedVotes,
        game.adminVoteSecretKey,
        playerPubKeys,
        game.round,
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
      const roundActionsDigestDay = buildDigestFromLedgerState(
        latestLedgerState,
        game.gameId,
        game.round,
        false,
      );
      const batcherClient = getBatcherClient();
      await batcherClient.resolveDay(
        game.gameId,
        BigInt(targetIdx),
        hasElimination,
        roundActionsDigestDay,
      );

      const nextPlayers = game.players.map((p) =>
        hasElimination && p.id === targetIdx ? { ...p, alive: false } : p
      );
      const outcome = getOutcome(nextPlayers);

      setGame({
        ...game,
        players: nextPlayers,
        round: game.round + 1,
        phase: outcome ? Phase.Finished : Phase.Night,
      });
      setDayVotes([]);
      setLastOutcome(
        `Day ${game.round}: ${getPlayerName(targetIdx)} ${
          hasElimination ? "eliminated" : "survived"
        } — ${result.info}`,
      );
      setStatus(
        outcome
          ? `Day resolved. ${result.info} ${outcome} Game finished.`
          : `Day resolved. ${result.info} ${getPlayerName(targetIdx)} ${
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
    startTx();
    try {
      const batcherClient = getBatcherClient();
      await batcherClient.revealPlayerRole(
        game.gameId,
        BigInt(player.id),
        BigInt(player.role),
        player.salt,
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
    startTx();
    try {
      // Use direct local call for verification to get the return value immediately.
      // TODO: Batcher delegation swallows the return value.
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
    startTx();
    try {
      const batcherClient = getBatcherClient();
      await batcherClient.forceEndGame(game.gameId, game.masterSecret);
      setGame({ ...game, phase: Phase.Finished });
      setStatus("Force ended the game (via batcher).");
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
    setChatRoomReady(false);
    setNightVotes([]);
    setDayVotes([]);
    setNightVoteInputs([]);
    setDayVoteInputs([]);
    setNightEliminationInput("0");
    setDayEliminationInput("0");
    setRevealPlayerIdx(0);
    setStatus("Game state cleared.");
  };

  const handleCopyGameCode = async () => {
    if (!game) return;
    const gameCode = werewolfIdCodec.encode(game.gameId);
    try {
      await navigator.clipboard.writeText(gameCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy game code:", err);
      setError("Failed to copy game code to clipboard.");
    }
  };

  return (
    <div className="page">
      <div className="app-container">
        <div className="main-content">
          <div className="card">
            <div className="title">Midnight dApp</div>
            <div className="subtitle">Werewolf game (Trusted Node view)</div>

            {game && (
              <div className="game-code-banner">
                <div className="game-code-label">Game Code</div>
                <div className="game-code-container">
                  <span className="game-code-text">
                    {werewolfIdCodec.encode(game.gameId)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-copy"
                    onClick={handleCopyGameCode}
                    disabled={loading}
                    title="Copy game code to clipboard"
                  >
                    {copied ? "✓ Copied!" : "📋 Copy"}
                  </button>
                </div>
              </div>
            )}

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
                onClick={openModal}
                disabled={loading || Boolean(evmAddress)}
                title={evmAddress ? "Wallet already connected" : undefined}
              >
                {evmAddress ? "EVM Wallet Connected" : "Connect EVM Wallet"}
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
                  {`GameId: `}
                  <GameIdDisplay gameId={game.gameId} />
                  {"\n"}
                  {`Round: ${game.round}\nPhase: ${
                    phaseName(game.phase)
                  }\nPlayers: ${game.playerCount}\nWerewolves: ${game.werewolfCount}`}
                </div>
              </div>
            )}

            <div className="columns">
              <div className="column">
                <div className="column-title">Trusted Node</div>
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
                      onChange={(event) =>
                        setPlayerCountInput(event.target.value)}
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
                    disabled={loading || !midnightAddress || !evmConnected}
                    title={!midnightAddress || !evmConnected
                      ? "Connect both wallets first"
                      : undefined}
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
                    <div className="field">
                      <div className="label">Eliminate player index</div>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={game.players.length - 1}
                        value={nightEliminationInput}
                        onChange={(event) =>
                          setNightEliminationInput(event.target.value)}
                        disabled={loading}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={handleResolveNight}
                      disabled={loading || game.phase !== Phase.Night ||
                        submitProgress !== null}
                    >
                      Resolve night
                    </button>
                  </div>
                )}

                {game && (
                  <div className="form">
                    <div className="label">Day resolution</div>
                    <div className="field">
                      <div className="label">Eliminate player index</div>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={game.players.length - 1}
                        value={dayEliminationInput}
                        onChange={(event) =>
                          setDayEliminationInput(event.target.value)}
                        disabled={loading}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={handleResolveDay}
                      disabled={loading || game.phase !== Phase.Day ||
                        submitProgress !== null}
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
              </div>

              <div className="column">
                <div className="column-title">Player Votes</div>
                {game
                  ? (
                    <>
                      <div className="form">
                        <div className="label">
                          {game.phase === Phase.Night
                            ? "Night votes"
                            : "Day votes"}
                        </div>
                        {game.players.map((player) => {
                          const voteTarget = receivedVotes.get(player.id);
                          const hasVoted = votedPlayerIndices.includes(
                            player.id,
                          );
                          return (
                            <div className="field" key={`vote-${player.id}`}>
                              <div className="label">
                                {getPlayerName(player.id)}{" "}
                                {player.alive ? "(alive)" : "(dead)"}
                              </div>
                              <div
                                className={`vote-display ${
                                  !player.alive
                                    ? "vote-display-dead"
                                    : hasVoted
                                    ? "vote-display-received"
                                    : "vote-display-waiting"
                                }`}
                              >
                                {hasVoted && voteTarget !== undefined
                                  ? (
                                    <span className="vote-display-text">
                                      Voted for{" "}
                                      <strong>
                                        {getPlayerName(voteTarget)}
                                      </strong>
                                    </span>
                                  )
                                  : player.alive
                                  ? (
                                    <span className="vote-display-text">
                                      Waiting for vote...
                                    </span>
                                  )
                                  : (
                                    <span className="vote-display-text vote-display-dead">
                                      No vote (dead)
                                    </span>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                        {receivedVotes.size > 0 && (
                          <div className="mono">
                            {game.phase === Phase.Night ? "NIGHT" : "DAY"}{" "}
                            votes received:{" "}
                            {receivedVotes.size}/{game.players.filter((p) =>
                              p.alive
                            ).length}
                          </div>
                        )}
                      </div>
                    </>
                  )
                  : <div className="mono">Create a game to enter votes.</div>}
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

            {game && game.phase !== Phase.Finished && (
              <div className="info">
                <div className="label">
                  Vote status — {game.phase === Phase.Night ? "NIGHT" : "DAY"}
                  {" "}
                  round {game.round} ({votedPlayerIndices.length}/
                  {game.players.filter((p) => p.alive).length} voted)
                </div>
                <div className="vote-status-grid">
                  {game.players.map((player) => {
                    const hasVoted = votedPlayerIndices.includes(player.id);
                    return (
                      <div
                        key={player.id}
                        className={`vote-status-cell ${
                          !player.alive
                            ? "vote-cell-dead"
                            : hasVoted
                            ? "vote-cell-voted"
                            : "vote-cell-waiting"
                        }`}
                        title={`${getPlayerName(player.id)} (${
                          roleName(player.role)
                        }) — ${
                          !player.alive
                            ? "dead"
                            : hasVoted
                            ? "voted"
                            : "waiting"
                        }`}
                      >
                        {getPlayerName(player.id)}
                        {!player.alive ? " ✕" : hasVoted ? " ✓" : " …"}
                      </div>
                    );
                  })}
                </div>

                {/* Submission progress bar */}
                {submitProgress !== null && (
                  <div className="submit-progress">
                    <div className="submit-progress-label">
                      Submitting votes to chain: {submitProgress.done} /{" "}
                      {submitProgress.total}
                    </div>
                    <div className="submit-progress-track">
                      <div
                        className="submit-progress-fill"
                        style={{
                          width: `${
                            submitProgress.total > 0
                              ? Math.round(
                                (submitProgress.done / submitProgress.total) *
                                  100,
                              )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Vote tally breakdown */}
                {voteTally.length > 0 && (() => {
                  const counts = new Map<number, number>();
                  for (const { target } of voteTally) {
                    counts.set(target, (counts.get(target) ?? 0) + 1);
                  }
                  const maxCount = Math.max(...counts.values());
                  const sorted = [...counts.entries()].sort((a, b) =>
                    b[1] - a[1]
                  );
                  return (
                    <div className="vote-tally">
                      <div className="vote-tally-title">Vote tally</div>
                      {sorted.map(([targetIdx, count]) => (
                        <div key={targetIdx} className="vote-tally-row">
                          <span className="vote-tally-player">
                            {getPlayerName(targetIdx)}
                          </span>
                          <span className="vote-tally-bar-wrap">
                            <span
                              className={`vote-tally-bar${
                                count === maxCount
                                  ? " vote-tally-bar-winner"
                                  : ""
                              }`}
                              style={{
                                width: `${
                                  Math.round((count / voteTally.length) * 100)
                                }%`,
                              }}
                            />
                          </span>
                          <span className="vote-tally-count">{count}</span>
                        </div>
                      ))}
                      <div className="vote-tally-breakdown">
                        {voteTally.map(({ voter, target }) =>
                          `${getPlayerName(voter)}→${getPlayerName(target)}`
                        ).join("  ")}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Last resolution outcome panel */}
            {lastOutcome && (
              <div
                className={`outcome-panel${
                  lastOutcome.includes("survived") ||
                    lastOutcome.includes("No valid")
                    ? " outcome-panel-safe"
                    : " outcome-panel-death"
                }`}
              >
                <span className="outcome-panel-icon">
                  {lastOutcome.includes("died") ||
                      lastOutcome.includes("eliminated")
                    ? "💀"
                    : "🛡️"}
                </span>
                <span className="outcome-panel-text">{lastOutcome}</span>
              </div>
            )}

            {midnightAddress && (
              <div className="info">
                <div className="label">Connected addresses</div>
                <div className="mono">Midnight: {midnightAddress}</div>
                {evmAddress && <div className="mono">EVM: {evmAddress}</div>}
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

            {error && <pre className="message message-error">{error}</pre>}
            {status && <pre className="message message-ok">{status}</pre>}
            {isModalOpen && <WalletModal onClose={closeModal} />}
          </div>
          {loading && txTimer.start != null && txPhase !== null && (
            <TxProgressModal phase={txPhase} elapsed={txTimer.elapsed} />
          )}
        </div>
        {game && midnightAddress && chatRoomReady && (
          <>
            <GameChat
              gameId={game.gameId}
              midnightAddressHash={midnightAddress}
            />
            <GameChat
              gameId={game.gameId}
              midnightAddressHash={midnightAddress}
              channel="werewolf"
              label="Werewolf Chat"
            />
          </>
        )}
      </div>
    </div>
  );
}

export default App;
