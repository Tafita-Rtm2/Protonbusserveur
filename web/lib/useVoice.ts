'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

type Signal = { from: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } };

/**
 * Vocal de room en WebRTC (maillage P2P). Le serveur Socket.io ne fait que relayer la signalisation ;
 * l'audio circule directement entre joueurs (rien ne passe par Vercel ni Hugging Face).
 * Convient jusqu'à ~8 personnes en vocal simultané.
 */
export function useVoice(socket: Socket | null, roomId: string | null) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});

  const local = useRef<MediaStream | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const pending = useRef(new Map<string, RTCIceCandidateInit[]>());
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const analysers = useRef(new Map<string, { node: AnalyserNode; buf: Uint8Array<ArrayBuffer> }>());
  const ctx = useRef<AudioContext | null>(null);
  const ice = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const joinedRef = useRef(false);

  const watch = useCallback((id: string, stream: MediaStream) => {
    try {
      if (!ctx.current) ctx.current = new AudioContext();
      const src = ctx.current.createMediaStreamSource(stream);
      const node = ctx.current.createAnalyser();
      node.fftSize = 512;
      src.connect(node);
      analysers.current.set(id, { node, buf: new Uint8Array(new ArrayBuffer(node.fftSize)) });
    } catch {
      /* détection de parole indisponible : non bloquant */
    }
  }, []);

  const closePeer = useCallback((id: string) => {
    pcs.current.get(id)?.close();
    pcs.current.delete(id);
    pending.current.delete(id);
    const a = audios.current.get(id);
    if (a) { a.pause(); a.srcObject = null; audios.current.delete(id); }
    analysers.current.delete(id);
    setSpeaking((s) => { const n = { ...s }; delete n[id]; return n; });
  }, []);

  const createPeer = useCallback((id: string, initiator: boolean) => {
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    pcs.current.set(id, pc);
    local.current?.getTracks().forEach((t) => pc.addTrack(t, local.current!));

    pc.onicecandidate = (e) => {
      if (e.candidate && socket) socket.emit('voice:signal', { to: id, data: { candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      let a = audios.current.get(id);
      if (!a) { a = new Audio(); a.autoplay = true; audios.current.set(id, a); }
      a.srcObject = stream;
      a.play().catch(() => {});
      watch(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(id);
    };

    if (initiator) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => socket?.emit('voice:signal', { to: id, data: { sdp: pc.localDescription } }))
        .catch(() => closePeer(id));
    }
    return pc;
  }, [socket, watch, closePeer]);

  const flush = async (id: string, pc: RTCPeerConnection) => {
    for (const c of pending.current.get(id) ?? []) await pc.addIceCandidate(c).catch(() => {});
    pending.current.delete(id);
  };

  // Signalisation entrante
  useEffect(() => {
    if (!socket) return;
    const onSignal = async ({ from, data }: Signal) => {
      if (!joinedRef.current || !local.current) return;
      try {
        if (data.sdp) {
          if (data.sdp.type === 'offer') {
            closePeer(from);
            const pc = createPeer(from, false);
            await pc.setRemoteDescription(data.sdp);
            await flush(from, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
          } else {
            const pc = pcs.current.get(from);
            if (pc) { await pc.setRemoteDescription(data.sdp); await flush(from, pc); }
          }
        } else if (data.candidate) {
          const pc = pcs.current.get(from);
          if (pc && pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
          else pending.current.set(from, [...(pending.current.get(from) ?? []), data.candidate]);
        }
      } catch {
        closePeer(from);
      }
    };
    const onPeerLeft = ({ socketId }: { socketId: string }) => closePeer(socketId);
    socket.on('voice:signal', onSignal);
    socket.on('voice:peer-left', onPeerLeft);
    return () => { socket.off('voice:signal', onSignal); socket.off('voice:peer-left', onPeerLeft); };
  }, [socket, createPeer, closePeer]);

  // Détection de "qui parle"
  useEffect(() => {
    const t = setInterval(() => {
      if (analysers.current.size === 0) return;
      const next: Record<string, boolean> = {};
      analysers.current.forEach(({ node, buf }, id) => {
        node.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        next[id] = Math.sqrt(sum / buf.length) > 0.035;
      });
      setSpeaking((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of keys) if (!!prev[k] !== !!next[k]) return next;
        return prev;
      });
    }, 150);
    return () => clearInterval(t);
  }, []);

  const leave = useCallback(() => {
    if (joinedRef.current) socket?.emit('voice:leave');
    joinedRef.current = false;
    Array.from(pcs.current.keys()).forEach(closePeer);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    analysers.current.clear();
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    setSpeaking({});
    setJoined(false);
    setMuted(false);
  }, [socket, closePeer]);

  const join = useCallback(async () => {
    if (!socket || joinedRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Le micro nécessite une connexion HTTPS et un navigateur récent.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      local.current = stream;
      const res: { ok: boolean; error?: string; peers?: { socketId: string }[]; iceServers?: RTCIceServer[] } =
        await new Promise((resolve) => socket.emit('voice:join', {}, resolve));
      if (!res?.ok) throw new Error(res?.error || 'Impossible de rejoindre le vocal.');
      if (res.iceServers?.length) ice.current = res.iceServers;
      joinedRef.current = true;
      setJoined(true);
      watch(socket.id ?? 'me', stream);
      (res.peers ?? []).forEach((p) => createPeer(p.socketId, true));
    } catch (e) {
      local.current?.getTracks().forEach((t) => t.stop());
      local.current = null;
      const name = (e as Error & { name?: string }).name;
      setError(
        name === 'NotAllowedError' ? 'Accès au micro refusé. Autorise-le dans ton navigateur.'
        : name === 'NotFoundError' ? 'Aucun micro détecté.'
        : (e as Error).message || 'Erreur vocale.'
      );
    } finally {
      setBusy(false);
    }
  }, [socket, busy, createPeer, watch]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
    socket?.emit('voice:state', { muted: next });
  }, [muted, socket]);

  // Quitte le vocal si on quitte / perd la room
  useEffect(() => {
    if (!roomId && joinedRef.current) leave();
  }, [roomId, leave]);
  useEffect(() => () => { if (joinedRef.current) leave(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { joined, muted, busy, error, speaking, join, leave, toggleMute };
}
