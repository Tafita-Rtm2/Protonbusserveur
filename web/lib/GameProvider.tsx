'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api } from './api';
import { android } from './android';
import type { Ack, BanEntry, ChatMsg, Member, RoomInfo, User } from './types';

const TOKEN_KEY = 'pbs_token';

export type Toast = { id: number; kind: 'info' | 'error' | 'success'; text: string };
export type CreateOpts = { name: string; maxPlayers: number; mapId: string; busId: string; password?: string };

type Ctx = {
  booting: boolean;
  user: User | null;
  connected: boolean;
  socket: Socket | null;
  rooms: RoomInfo[];
  room: RoomInfo | null;
  roomId: string | null;
  members: Member[];
  bans: BanEntry[];
  chat: ChatMsg[];
  isHost: boolean;
  toasts: Toast[];
  login: (u: string, p: string) => Promise<string | null>;
  register: (u: string, p: string) => Promise<string | null>;
  logout: () => void;
  refreshRooms: () => void;
  createRoom: (o: CreateOpts) => Promise<string | null>;
  joinRoom: (id: string, password?: string) => Promise<string | null>;
  leaveRoom: () => void;
  kick: (socketId: string) => void;
  ban: (socketId: string) => void;
  unban: (key: string) => void;
  closeRoom: () => void;
  sendChat: (text: string) => void;
  dismissToast: (id: number) => void;
};

const GameCtx = createContext<Ctx | null>(null);
export const useGame = () => {
  const c = useContext(GameCtx);
  if (!c) throw new Error('useGame hors GameProvider');
  return c;
};

/** Un joueur connecté à la fois depuis le site et depuis le jeu n'apparaît qu'une fois. */
function dedupe(list: Member[], mySocketId?: string): Member[] {
  const groups = new Map<string, Member[]>();
  for (const m of list) {
    const k = m.username.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return Array.from(groups.values()).map((g) => {
    const base = g.find((m) => m.socketId === mySocketId) ?? g.find((m) => m.inVoice) ?? g[0];
    const voice = g.find((m) => m.inVoice);
    return { ...base, inVoice: !!voice, muted: voice ? voice.muted : false };
  });
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const roomIdRef = useRef<string | null>(null);
  const roomInfoRef = useRef<RoomInfo | null>(null);
  const userRef = useRef<User | null>(null);
  const toastId = useRef(0);

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { roomInfoRef.current = roomInfo; }, [roomInfo]);
  useEffect(() => { userRef.current = user; }, [user]);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const resetRoom = useCallback(() => {
    setRoomId(null); setRoomInfo(null); setHostId(null); setMembers([]); setBans([]); setChat([]);
  }, []);

  // --- Session au chargement -------------------------------------------------
  useEffect(() => {
    (async () => {
      const saved = localStorage.getItem(TOKEN_KEY);
      if (saved) {
        const u = await api.me(saved);
        if (u) { setToken(saved); setUser(u); }
        else localStorage.removeItem(TOKEN_KEY);
      }
      setBooting(false);
    })();
  }, []);

  // --- Connexion Socket.io -----------------------------------------------------
  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    let s: Socket | null = null;

    (async () => {
      // Même origine que le site : Vercel relaie /socket.io vers le serveur (URL Hugging Face jamais exposée).
      // Vercel ne supporte pas les WebSockets => long-polling uniquement.
      s = io({ path: '/socket.io', auth: { token, client: 'web' }, transports: ['polling'], reconnectionDelayMax: 5000 });
      setSocket(s);

      s.on('connect', () => {
        setConnected(true);
        if (roomIdRef.current) { resetRoom(); toast('info', 'Connexion rétablie : tu as quitté la room.'); }
      });
      s.on('disconnect', () => setConnected(false));
      s.on('connect_error', (e) => {
        if (e.message === 'AUTH_REQUIRED') { toast('error', 'Session expirée, reconnecte-toi.'); logoutRef.current(); }
      });

      s.on('roomList', (list: RoomInfo[]) => {
        setRooms(list);
        if (roomIdRef.current) {
          const mine = list.find((r) => r.id === roomIdRef.current);
          if (mine) setRoomInfo(mine);
        }
      });
      s.on('roomMembers', (d: { roomId: string; hostId: string; members: Member[] }) => {
        setRoomId(d.roomId); setHostId(d.hostId); setMembers(dedupe(d.members, s?.id));
      });
      s.on('roomBans', (d: { bans: BanEntry[] }) => setBans(d.bans));
      s.on('roomChat', (m: ChatMsg) => setChat((c) => [...c.slice(-199), m]));
      s.on('playerJoined', (p: { username: string }) =>
        setChat((c) => [...c.slice(-199), { id: `j${Date.now()}${Math.random()}`, text: `${p.username} a rejoint la room`, ts: Date.now(), system: true }]));
      s.on('playerLeft', (p: { username: string }) =>
        setChat((c) => [...c.slice(-199), { id: `l${Date.now()}${Math.random()}`, text: `${p.username} a quitté la room`, ts: Date.now(), system: true }]));
      s.on('hostChanged', (d: { newHostUsername: string; room: RoomInfo }) => {
        setRoomInfo(d.room);
        toast('info', `${d.newHostUsername} est maintenant le créateur de la room.`);
      });
      s.on('kicked', (d: { roomName: string; banned: boolean }) => {
        resetRoom();
        toast('error', d.banned ? `Tu as été banni de « ${d.roomName} ».` : `Tu as été expulsé de « ${d.roomName} ».`);
      });
      s.on('roomClosed', (d: { roomName: string; by: string }) => {
        resetRoom();
        toast('info', `La room « ${d.roomName} » a été fermée par ${d.by || 'le créateur'}.`);
      });
    })();

    return () => {
      cancelled = true;
      s?.removeAllListeners();
      s?.disconnect();
      setSocket(null); setConnected(false); setRooms([]); resetRoom();
    };
  }, [token, user, toast, resetRoom]);

  // --- Actions -----------------------------------------------------------------
  const finishAuth = useCallback((res: { token?: string; user?: User; error?: string }) => {
    if (res.error || !res.token || !res.user) return res.error || 'Erreur inconnue.';
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
    return null;
  }, []);

  const login = useCallback(async (u: string, p: string) => finishAuth(await api.login(u, p)), [finishAuth]);
  const register = useCallback(async (u: string, p: string) => finishAuth(await api.register(u, p)), [finishAuth]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null); setUser(null);
  }, []);
  const logoutRef = useRef(logout);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  const refreshRooms = useCallback(() => { socket?.emit('getRooms', () => {}); }, [socket]);

  const emitAck = useCallback(
    (event: string, payload: unknown) =>
      new Promise<Ack>((resolve) => {
        if (!socket?.connected) return resolve({ ok: false, error: 'Non connecté au serveur.' });
        const t = setTimeout(() => resolve({ ok: false, error: 'Le serveur ne répond pas.' }), 8000);
        socket.emit(event, payload, (r: Ack) => { clearTimeout(t); resolve(r); });
      }),
    [socket]
  );

  const enter = useCallback((r: Ack) => {
    if (!r.ok || !r.room) return r.error || 'Erreur.';
    setChat([]);
    setRoomId(r.room.id); setRoomInfo(r.room); setHostId(r.room.hostId);
    // Comme l'ancien menu : dès qu'on entre dans un salon, on donne pseudo/roomId/mapId/busId au jeu (AndroidHost.launchGame)
    // pour que le mod rejoigne le salon et affiche les voitures. Sans cet appel le mod reste connecté mais "sans salon".
    const u = userRef.current;
    if (u && android.launch({ pseudo: u.username, roomId: r.room.id, mapId: r.room.mapId, busId: r.room.busId })) {
      toast('success', '🎮 Jeu synchronisé avec la room.');
    }
    return null;
  }, [toast]);

  const createRoom = useCallback(async (o: CreateOpts) => {
    const r = await emitAck('createRoom', {
      roomName: o.name, maxPlayers: o.maxPlayers, mapId: o.mapId, busId: o.busId,
      isPrivate: !!o.password, password: o.password || undefined,
    });
    return enter(r);
  }, [emitAck, enter]);

  const joinRoom = useCallback(async (id: string, password?: string) => {
    const r = await emitAck('joinRoom', { roomId: id, password: password || undefined });
    return enter(r);
  }, [emitAck, enter]);

  const leaveRoom = useCallback(() => { socket?.emit('leaveRoom', () => {}); resetRoom(); }, [socket, resetRoom]);
  const kick = useCallback(async (id: string) => { const r = await emitAck('kickPlayer', { socketId: id }); if (!r.ok) toast('error', r.error || 'Échec.'); }, [emitAck, toast]);
  const ban = useCallback(async (id: string) => { const r = await emitAck('banPlayer', { socketId: id }); if (!r.ok) toast('error', r.error || 'Échec.'); }, [emitAck, toast]);
  const unban = useCallback(async (key: string) => { const r = await emitAck('unbanPlayer', { key }); if (!r.ok) toast('error', r.error || 'Échec.'); }, [emitAck, toast]);
  const closeRoom = useCallback(async () => { const r = await emitAck('closeRoom', {}); if (r.ok) { resetRoom(); toast('success', 'Room fermée.'); } else toast('error', r.error || 'Échec.'); }, [emitAck, toast, resetRoom]);
  const sendChat = useCallback((text: string) => { socket?.emit('roomChat', { text }); }, [socket]);

  const value = useMemo<Ctx>(() => ({
    booting, user, connected, socket, rooms, room: roomInfo, roomId, members, bans, chat,
    isHost: !!socket?.id && hostId === socket.id, toasts,
    login, register, logout, refreshRooms, createRoom, joinRoom, leaveRoom, kick, ban, unban, closeRoom, sendChat, dismissToast,
  }), [booting, user, connected, socket, rooms, roomInfo, roomId, members, bans, chat, hostId, toasts,
    login, register, logout, refreshRooms, createRoom, joinRoom, leaveRoom, kick, ban, unban, closeRoom, sendChat, dismissToast]);

  return <GameCtx.Provider value={value}>{children}</GameCtx.Provider>;
}
