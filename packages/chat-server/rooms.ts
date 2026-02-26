interface Room {
  allowedPlayers: Set<string>; // midnightAddressHash values
  connections: Map<string, WebSocket>; // hash -> socket
}

const rooms = new Map<number, Room>();

function ensureRoom(gameId: number): Room {
  let room = rooms.get(gameId);
  if (!room) {
    room = { allowedPlayers: new Set(), connections: new Map() };
    rooms.set(gameId, room);
  }
  return room;
}

export function invitePlayer(gameId: number, midnightAddressHash: string): void {
  ensureRoom(gameId).allowedPlayers.add(midnightAddressHash);
}

export function isAllowed(gameId: number, midnightAddressHash: string): boolean {
  return rooms.get(gameId)?.allowedPlayers.has(midnightAddressHash) ?? false;
}

export function isAlreadyConnected(gameId: number, midnightAddressHash: string): boolean {
  return rooms.get(gameId)?.connections.has(midnightAddressHash) ?? false;
}

export function addConnection(
  gameId: number,
  midnightAddressHash: string,
  socket: WebSocket,
): void {
  ensureRoom(gameId).connections.set(midnightAddressHash, socket);
}

export function removeConnection(gameId: number, midnightAddressHash: string): void {
  rooms.get(gameId)?.connections.delete(midnightAddressHash);
}

export function broadcast(gameId: number, payload: string, excludeHash?: string): void {
  const room = rooms.get(gameId);
  if (!room) return;
  for (const [hash, socket] of room.connections) {
    if (hash === excludeHash) continue;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

export function broadcastAll(gameId: number, payload: string): void {
  broadcast(gameId, payload);
}
