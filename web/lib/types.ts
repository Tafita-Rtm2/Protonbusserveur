export type User = { id: string; username: string; pseudo: string };

export type RoomInfo = {
  id: string;
  name: string;
  isPrivate: boolean;
  hasPassword: boolean;
  mapId: string;
  busId: string;
  maxPlayers: number;
  playerCount: number;
  hostId: string;
  hostUsername: string;
  players: string[];
  createdAt: number;
};

export type Member = {
  socketId: string;
  userId: string;
  username: string;
  inVoice: boolean;
  muted: boolean;
};

export type BanEntry = { key: string; name: string };

export type ChatMsg = {
  id: string;
  socketId?: string;
  username?: string;
  text: string;
  ts: number;
  system?: boolean;
};

export type Ack = { ok: boolean; error?: string; code?: string; room?: RoomInfo };
