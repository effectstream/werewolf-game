import type { BroadcastBody, ClientMessage, InviteBody, ServerMessage } from "./types.ts";
import {
  addConnection,
  broadcastAll,
  broadcast,
  invitePlayer,
  isAllowed,
  isAlreadyConnected,
  removeConnection,
} from "./rooms.ts";

const MAX_TEXT_LENGTH = 500;
const IDENTIFY_TIMEOUT_MS = 10_000;

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function parseGameId(pathname: string): number | null {
  const match = pathname.match(/^\/chat\/(\d+)$/);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return isNaN(id) ? null : id;
}

function handleWebSocket(req: Request, gameId: number): Response {
  const { socket, response } = Deno.upgradeWebSocket(req);

  let identified = false;
  let playerHash: string | null = null;

  const identifyTimer = setTimeout(() => {
    if (!identified) {
      send(socket, {
        type: "error",
        code: "IDENTIFY_TIMEOUT",
        message: "You must identify within 10 seconds.",
      });
      socket.close(4001, "Identify timeout");
    }
  }, IDENTIFY_TIMEOUT_MS);

  socket.onmessage = (event) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(event.data) as ClientMessage;
    } catch {
      send(socket, { type: "error", code: "PARSE_ERROR", message: "Invalid JSON." });
      return;
    }

    if (!identified) {
      if (msg.type !== "identify") {
        send(socket, {
          type: "error",
          code: "NOT_IDENTIFIED",
          message: "Send an identify message first.",
        });
        return;
      }

      const hash = msg.midnightAddressHash;

      if (!isAllowed(gameId, hash)) {
        send(socket, {
          type: "error",
          code: "NOT_ALLOWED",
          message: "You are not invited to this game room.",
        });
        socket.close(4003, "Not allowed");
        return;
      }

      if (isAlreadyConnected(gameId, hash)) {
        send(socket, {
          type: "error",
          code: "ALREADY_CONNECTED",
          message: "Another connection from this player already exists.",
        });
        socket.close(4004, "Duplicate connection");
        return;
      }

      clearTimeout(identifyTimer);
      identified = true;
      playerHash = hash;
      addConnection(gameId, hash, socket);
      send(socket, { type: "identified", midnightAddressHash: hash });
      return;
    }

    if (msg.type !== "message") {
      send(socket, { type: "error", code: "UNKNOWN_TYPE", message: "Unknown message type." });
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
      from: playerHash!,
      text,
      timestamp: Date.now(),
    };
    const serialized = JSON.stringify(outbound);

    // Echo back to sender and broadcast to all others
    send(socket, outbound);
    broadcast(gameId, serialized, playerHash!);
  };

  socket.onclose = () => {
    clearTimeout(identifyTimer);
    if (playerHash) removeConnection(gameId, playerHash);
  };

  socket.onerror = (err) => {
    console.error(`[chat] WebSocket error game=${gameId} player=${playerHash}:`, err);
    clearTimeout(identifyTimer);
    if (playerHash) removeConnection(gameId, playerHash);
  };

  return response;
}

async function handleInvite(req: Request): Promise<Response> {
  let body: Partial<InviteBody>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gameId = typeof body.gameId === "number" ? body.gameId : null;
  const hash = typeof body.midnightAddressHash === "string"
    ? body.midnightAddressHash.trim()
    : null;

  if (!gameId || !hash) {
    return Response.json(
      { error: "gameId (number) and midnightAddressHash (string) are required" },
      { status: 400 },
    );
  }

  invitePlayer(gameId, hash);
  console.log(`[chat] Invited player=${hash} to game=${gameId}`);
  return Response.json({ ok: true });
}

async function handleBroadcast(req: Request): Promise<Response> {
  let body: Partial<BroadcastBody>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gameId = typeof body.gameId === "number" ? body.gameId : null;
  const text = typeof body.text === "string" ? body.text.trim() : null;

  if (!gameId || !text) {
    return Response.json(
      { error: "gameId (number) and text (string) are required" },
      { status: 400 },
    );
  }

  const msg: ServerMessage = { type: "system", text, timestamp: Date.now() };
  broadcastAll(gameId, JSON.stringify(msg));
  console.log(`[chat] System broadcast game=${gameId}: ${text}`);
  return Response.json({ ok: true });
}

export function startChatServer(port: number): void {
  Deno.serve({ port }, async (req) => {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/invite") {
      return await handleInvite(req);
    }

    if (req.method === "POST" && url.pathname === "/broadcast") {
      return await handleBroadcast(req);
    }

    if (req.method === "GET" && url.pathname.startsWith("/chat/")) {
      const gameId = parseGameId(url.pathname);
      if (gameId === null) {
        return Response.json({ error: "Invalid game ID in path" }, { status: 400 });
      }
      const upgrade = req.headers.get("upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      return handleWebSocket(req, gameId);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return new Response("Not found", { status: 404 });
  });

  console.log(`[chat] Chat server listening on port ${port}`);
}
