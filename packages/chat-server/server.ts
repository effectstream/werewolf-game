import type { ServerWebSocket } from "bun";
import type {
  BroadcastBody,
  ClientMessage,
  CreateRoomBody,
  InviteBody,
  ServerMessage,
} from "./types.ts";

interface WsData {
  gameId: number;
  channel: string;
  identified: boolean;
  playerHash: string | null;
  identifyTimer: ReturnType<typeof setTimeout> | null;
}
import {
  addConnection,
  broadcast,
  broadcastAll,
  getNickname,
  getRoomsSnapshot,
  invitePlayer,
  isAllowed,
  isAlreadyConnected,
  removeConnection,
} from "./rooms.ts";

const IS_DEV = process.env["ENV"] === "dev" ||
  process.env["ENV"] === "development";

const MAX_TEXT_LENGTH = 500;
const IDENTIFY_TIMEOUT_MS = 10_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) },
  });
}

function send(socket: ServerWebSocket<WsData>, msg: ServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(msg));
  }
}

function parseChatPath(
  pathname: string,
): { gameId: number; channel: string } | null {
  const match = pathname.match(/^\/chat\/(\d+)(?:\/(\w+))?$/);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  if (isNaN(id)) return null;
  return { gameId: id, channel: match[2] ?? "general" };
}

function handleWsOpen(socket: ServerWebSocket<WsData>): void {
  socket.data.identifyTimer = setTimeout(() => {
    if (!socket.data.identified) {
      send(socket, {
        type: "error",
        code: "IDENTIFY_TIMEOUT",
        message: "You must identify within 10 seconds.",
      });
      socket.close(4001, "Identify timeout");
    }
  }, IDENTIFY_TIMEOUT_MS);
}

function handleWsMessage(
  socket: ServerWebSocket<WsData>,
  raw: string | Buffer,
): void {
  const { gameId, channel } = socket.data;

  let msg: ClientMessage;
  try {
    msg = JSON.parse(
      typeof raw === "string" ? raw : raw.toString(),
    ) as ClientMessage;
  } catch {
    send(socket, {
      type: "error",
      code: "PARSE_ERROR",
      message: "Invalid JSON.",
    });
    return;
  }

  if (!socket.data.identified) {
    if (msg.type !== "identify") {
      send(socket, {
        type: "error",
        code: "NOT_IDENTIFIED",
        message: "Send an identify message first.",
      });
      return;
    }

    const hash = msg.publicKeyHex;

    if (!isAllowed(gameId, hash, channel)) {
      console.warn(
        `[chat] NOT_ALLOWED game=${gameId} channel=${channel} hash=${hash} — ` +
          `snapshot: ${
            JSON.stringify(
              getRoomsSnapshot().filter((r) => r.gameId === gameId),
            )
          }`,
      );
      send(socket, {
        type: "error",
        code: "NOT_ALLOWED",
        message: "You are not invited to this game room.",
      });
      socket.close(4003, "Not allowed");
      return;
    }

    if (isAlreadyConnected(gameId, hash, channel)) {
      console.warn(
        `[chat] ALREADY_CONNECTED game=${gameId} channel=${channel} hash=${hash}`,
      );
      send(socket, {
        type: "error",
        code: "ALREADY_CONNECTED",
        message: "Another connection from this player already exists.",
      });
      socket.close(4004, "Duplicate connection");
      return;
    }

    if (socket.data.identifyTimer) clearTimeout(socket.data.identifyTimer);
    socket.data.identified = true;
    socket.data.playerHash = hash;
    addConnection(gameId, hash, socket, channel);
    console.log(
      `[chat] Identified game=${gameId} channel=${channel} hash=${hash}`,
    );
    send(socket, { type: "identified", publicKeyHex: hash });
    return;
  }

  if (msg.type !== "message") {
    send(socket, {
      type: "error",
      code: "UNKNOWN_TYPE",
      message: "Unknown message type.",
    });
    return;
  }

  const text = msg.text?.trim() ?? "";
  if (!text || text.length > MAX_TEXT_LENGTH) {
    send(socket, {
      type: "error",
      code: "INVALID_MESSAGE",
      message: `Message must be 1-${MAX_TEXT_LENGTH} characters.`,
    });
    return;
  }

  const outbound: ServerMessage = {
    type: "message",
    from: getNickname(gameId, socket.data.playerHash!, channel),
    text,
    timestamp: Date.now(),
  };
  const serialized = JSON.stringify(outbound);

  // Echo back to sender and broadcast to all others
  send(socket, outbound);
  broadcast(gameId, serialized, socket.data.playerHash!, channel);
}

function handleWsClose(socket: ServerWebSocket<WsData>): void {
  if (socket.data.identifyTimer) clearTimeout(socket.data.identifyTimer);
  if (socket.data.playerHash) {
    removeConnection(socket.data.gameId, socket.data.playerHash, socket.data.channel);
  }
}

async function handleInvite(req: Request): Promise<Response> {
  let body: Partial<InviteBody>;
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gameId = typeof body.gameId === "number" ? body.gameId : null;
  const hash = typeof body.publicKeyHex === "string"
    ? body.publicKeyHex.trim()
    : null;
  const nickname = typeof body.nickname === "string"
    ? body.nickname.trim()
    : null;
  const channel = typeof body.channel === "string"
    ? body.channel.trim()
    : "general";

  if (!gameId || !hash || !nickname) {
    return corsJson(
      {
        error:
          "gameId (number), publicKeyHex (string), and nickname (string) are required",
      },
      { status: 400 },
    );
  }

  invitePlayer(gameId, hash, nickname, channel);
  console.log(
    `[chat] Invited player=${hash} nickname=${nickname} to game=${gameId} channel=${channel}`,
  );
  return corsJson({ ok: true });
}

async function handleCreateRoom(req: Request): Promise<Response> {
  let body: Partial<CreateRoomBody>;
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gameId = typeof body.gameId === "number" ? body.gameId : null;
  const hash = typeof body.moderatorHash === "string"
    ? body.moderatorHash.trim()
    : null;

  if (!gameId || !hash) {
    return corsJson(
      { error: "gameId (number) and moderatorHash (string) are required" },
      { status: 400 },
    );
  }

  // Pre-invite moderator to both channels so they can observe all chat
  invitePlayer(gameId, hash, "Moderator", "general");
  invitePlayer(gameId, hash, "Moderator", "werewolf");
  console.log(
    `[chat] Created room game=${gameId} moderator=${hash} (invited to general + werewolf)`,
  );

  // After 10 s, send a welcome system message to everyone connected in the room.
  setTimeout(() => {
    const msg: ServerMessage = {
      type: "system",
      text: "Welcome to the Werewolf Midnight",
      timestamp: Date.now(),
    };
    broadcastAll(gameId, JSON.stringify(msg), "general");
    console.log(`[chat] Sent welcome message to game=${gameId}`);
  }, 10_000);

  return corsJson({ ok: true });
}

async function handleBroadcast(req: Request): Promise<Response> {
  let body: Partial<BroadcastBody>;
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gameId = typeof body.gameId === "number" ? body.gameId : null;
  const text = typeof body.text === "string" ? body.text.trim() : null;
  const channel = typeof body.channel === "string"
    ? body.channel.trim()
    : "general";

  if (!gameId || !text) {
    return corsJson(
      { error: "gameId (number) and text (string) are required" },
      { status: 400 },
    );
  }

  const msg: ServerMessage = { type: "system", text, timestamp: Date.now() };
  broadcastAll(gameId, JSON.stringify(msg), channel);
  console.log(
    `[chat] System broadcast game=${gameId} channel=${channel}: ${text}`,
  );
  return corsJson({ ok: true });
}

export function startChatServer(port: number): void {
  const server = Bun.serve<WsData, undefined>({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Handle CORS preflight for all routes
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      if (req.method === "POST" && url.pathname === "/create-room") {
        return await handleCreateRoom(req);
      }

      if (req.method === "POST" && url.pathname === "/invite") {
        return await handleInvite(req);
      }

      if (req.method === "POST" && url.pathname === "/broadcast") {
        return await handleBroadcast(req);
      }

      if (req.method === "GET" && url.pathname.startsWith("/chat/")) {
        const parsed = parseChatPath(url.pathname);
        if (parsed === null) {
          return corsJson({ error: "Invalid game ID in path" }, {
            status: 400,
          });
        }
        const upgrade = req.headers.get("upgrade");
        if (!upgrade || upgrade.toLowerCase() !== "websocket") {
          return new Response("Expected WebSocket upgrade", { status: 426 });
        }
        const ok = server.upgrade(req, {
          data: {
            gameId: parsed.gameId,
            channel: parsed.channel,
            identified: false,
            playerHash: null,
            identifyTimer: null,
          },
        });
        if (ok) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return corsJson({ status: "ok" });
      }

      if (IS_DEV && req.method === "GET" && url.pathname === "/debug/rooms") {
        return corsJson(getRoomsSnapshot());
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open: handleWsOpen,
      message: handleWsMessage,
      close: handleWsClose,
    },
  });

  console.log(`[chat] Chat server listening on port ${server.port}`);
}
