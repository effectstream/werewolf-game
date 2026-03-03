interface Room {
  allowedPlayers: Set<string>; // midnightAddressHash values
  connections: Map<string, WebSocket>; // hash -> socket
  nicknames: Map<string, string>; // hash -> nickname
}

const rooms = new Map<string, Room>();

function roomKey(gameId: number, channel = "general"): string {
  return `${gameId}:${channel}`;
}

function ensureRoom(gameId: number, channel = "general"): Room {
  const key = roomKey(gameId, channel);
  let room = rooms.get(key);
  if (!room) {
    room = { allowedPlayers: new Set(), connections: new Map(), nicknames: new Map() };
    rooms.set(key, room);
  }
  return room;
}

export function invitePlayer(gameId: number, midnightAddressHash: string, nickname = "", channel = "general"): void {
  const room = ensureRoom(gameId, channel);
  room.allowedPlayers.add(midnightAddressHash);
  if (nickname) room.nicknames.set(midnightAddressHash, nickname);
}

export function getNickname(gameId: number, midnightAddressHash: string, channel = "general"): string {
  return rooms.get(roomKey(gameId, channel))?.nicknames.get(midnightAddressHash) ?? midnightAddressHash.slice(0, 10) + "…";
}

export function isAllowed(gameId: number, midnightAddressHash: string, channel = "general"): boolean {
  return rooms.get(roomKey(gameId, channel))?.allowedPlayers.has(midnightAddressHash) ?? false;
}

export function isAlreadyConnected(gameId: number, midnightAddressHash: string, channel = "general"): boolean {
  return rooms.get(roomKey(gameId, channel))?.connections.has(midnightAddressHash) ?? false;
}

export function addConnection(
  gameId: number,
  midnightAddressHash: string,
  socket: WebSocket,
  channel = "general",
): void {
  ensureRoom(gameId, channel).connections.set(midnightAddressHash, socket);
}

export function removeConnection(gameId: number, midnightAddressHash: string, channel = "general"): void {
  rooms.get(roomKey(gameId, channel))?.connections.delete(midnightAddressHash);
}

export function broadcast(gameId: number, payload: string, excludeHash?: string, channel = "general"): void {
  const room = rooms.get(roomKey(gameId, channel));
  if (!room) return;
  for (const [hash, socket] of room.connections) {
    if (hash === excludeHash) continue;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

export function broadcastAll(gameId: number, payload: string, channel = "general"): void {
  broadcast(gameId, payload, undefined, channel);
}

// ---------------------------------------------------------------------------
// Debug snapshot — returns a plain-object view of all rooms (no WebSockets).
// ---------------------------------------------------------------------------
export interface RoomSnapshot {
  key: string;
  gameId: number;
  channel: string;
  allowed: { hash: string; nickname: string }[];
  connected: { hash: string; nickname: string; readyState: number }[];
}

export function getRoomsSnapshot(): RoomSnapshot[] {
  const out: RoomSnapshot[] = [];
  for (const [key, room] of rooms) {
    const [gameIdStr, channel] = key.split(":");
    const allowed = [...room.allowedPlayers].map((hash) => ({
      hash,
      nickname: room.nicknames.get(hash) ?? "",
    }));
    const connected = [...room.connections.entries()].map(([hash, socket]) => ({
      hash,
      nickname: room.nicknames.get(hash) ?? "",
      readyState: socket.readyState,
    }));
    out.push({ key, gameId: Number(gameIdStr), channel, allowed, connected });
  }
  return out;
}
