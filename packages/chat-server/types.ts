// Messages sent from client to server
export type ClientMessage =
  | { type: "identify"; midnightAddressHash: string }
  | { type: "message"; text: string };

// Messages sent from server to client
export type ServerMessage =
  | { type: "identified"; midnightAddressHash: string }
  | { type: "message"; from: string; text: string; timestamp: number }
  | { type: "system"; text: string; timestamp: number }
  | { type: "error"; code: string; message: string };

// HTTP body for POST /invite
export interface InviteBody {
  gameId: number;
  midnightAddressHash: string;
}

// HTTP body for POST /broadcast
export interface BroadcastBody {
  gameId: number;
  text: string;
}

// HTTP body for POST /create-room — creates the room and pre-invites the moderator
export interface CreateRoomBody {
  gameId: number;
  moderatorHash: string;
}
