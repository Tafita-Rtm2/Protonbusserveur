'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bus, Crown, KeyRound, Loader2, Lock, LogOut, Map as MapIcon, Plus, RefreshCw, ScrollText, Search, Smartphone, Users, Wifi, WifiOff } from 'lucide-react';
import { android } from '@/lib/android';
import { LogsModal } from './LogsModal';
import { useGame } from '@/lib/GameProvider';
import type { RoomInfo } from '@/lib/types';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { Avatar } from './Avatar';

export function Lobby() {
  const { user, connected, rooms, logout, refreshRooms } = useGame();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [joinTarget, setJoinTarget] = useState<RoomInfo | null>(null);
  const [logs, setLogs] = useState(false);
  const [native, setNative] = useState<{ ok: boolean; logs: boolean } | null>(null);
  useEffect(() => { setNative({ ok: android.canLaunch(), logs: android.hasLogs() }); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.hostUsername.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [rooms, query]);

  const totalPlayers = rooms.reduce((n, r) => n + r.playerCount, 0);

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16 pt-5 sm:px-6">
      {/* Barre du haut */}
      <header className="glass flex items-center justify-between gap-3 px-4 py-3">
        <Logo size={40} withText />
        <div className="flex items-center gap-2 sm:gap-3">
          <span className={`chip ${connected ? 'text-emerald-300' : 'text-amber-300'}`}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span className="hidden sm:inline">{connected ? 'En ligne' : 'Connexion…'}</span>
          </span>
          <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3">
            <Avatar name={user!.username} size={30} />
            <span className="max-w-[110px] truncate text-sm font-semibold text-white">{user!.username}</span>
          </div>
          {native?.logs && (
            <button onClick={() => setLogs(true)} className="icon-btn h-10 w-10 border border-white/10" title="Voir les logs" aria-label="Voir les logs"><ScrollText size={18} /></button>
          )}
          <button onClick={logout} className="icon-btn h-10 w-10 border border-white/10" title="Se déconnecter" aria-label="Se déconnecter"><LogOut size={18} /></button>
        </div>
      </header>

      {native && !native.ok && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <Smartphone size={18} className="mt-0.5 shrink-0" />
          <p><strong>Information :</strong> ouvre cette page depuis l’application Launcher Proton Bus Sync pour lancer le jeu.</p>
        </div>
      )}

      {/* Titre + actions */}
      <section className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Rooms disponibles</h1>
          <p className="mt-1.5 text-slate-400">Rejoins une partie en cours ou crée la tienne.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="chip"><MapIcon size={14} className="text-brand-400" />{rooms.length} room{rooms.length > 1 ? 's' : ''}</span>
            <span className="chip"><Users size={14} className="text-brand-400" />{totalPlayers} joueur{totalPlayers > 1 ? 's' : ''} en room</span>
          </div>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary px-6 py-3.5 text-base" disabled={!connected}>
          <Plus size={20} strokeWidth={2.6} /> Créer une room
        </button>
      </section>

      {/* Recherche */}
      <div className="mt-6 flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-11" placeholder="Rechercher une room ou un créateur…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button onClick={refreshRooms} className="btn-ghost px-4" aria-label="Actualiser"><RefreshCw size={18} /></button>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="glass mt-8 flex flex-col items-center px-6 py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-slate-500"><Bus size={30} /></div>
          <h3 className="text-lg font-semibold text-white">{rooms.length ? 'Aucun résultat' : 'Aucune room pour le moment'}</h3>
          <p className="mt-1 max-w-sm text-sm text-slate-400">{rooms.length ? 'Essaie un autre mot-clé.' : 'Sois le premier : crée une room et invite tes amis !'}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => <RoomCard key={r.id} room={r} onJoin={() => setJoinTarget(r)} />)}
        </div>
      )}

      {logs && <LogsModal onClose={() => setLogs(false)} />}
      {creating && <CreateModal onClose={() => setCreating(false)} />}
      {joinTarget && <JoinModal room={joinTarget} onClose={() => setJoinTarget(null)} />}
    </div>
  );
}

function RoomCard({ room, onJoin }: { room: RoomInfo; onJoin: () => void }) {
  const full = room.playerCount >= room.maxPlayers;
  const pct = Math.min(100, (room.playerCount / room.maxPlayers) * 100);
  return (
    <article className="glass group flex animate-pop flex-col p-5 transition hover:border-brand-500/40 hover:bg-white/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-lg font-bold leading-snug text-white">{room.name}</h3>
        {room.isPrivate && (
          <span className="chip shrink-0 border-amber-400/30 text-amber-300"><Lock size={12} />Privée</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm text-slate-400">
        <Crown size={14} className="text-brand-400" /> {room.hostUsername || '—'}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="chip"><MapIcon size={12} />{room.mapId}</span>
        <span className="chip"><Bus size={12} />{room.busId}</span>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><Users size={13} />Joueurs</span>
          <span className="font-semibold text-slate-200">{room.playerCount}/{room.maxPlayers}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${full ? 'bg-rose-400' : 'bg-gradient-to-r from-brand-300 to-brand-500'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button onClick={onJoin} disabled={full} className="btn-primary mt-5 w-full">
        {full ? 'Room pleine' : 'Rejoindre'}
      </button>
    </article>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const { createRoom } = useGame();
  const [name, setName] = useState('');
  const [max, setMax] = useState(10);
  const [mapId, setMapId] = useState('map_tana');
  const [busId, setBusId] = useState('bus_default');
  const [priv, setPriv] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Donne un nom à ta room.');
    if (priv && !password) return setError('Choisis un mot de passe pour la room privée.');
    setBusy(true);
    const err = await createRoom({ name: name.trim(), maxPlayers: max, mapId: mapId.trim() || 'map_tana', busId: busId.trim() || 'bus_default', password: priv ? password : undefined });
    setBusy(false);
    if (err) setError(err); // en cas de succès, la vue bascule automatiquement dans la room
  }

  return (
    <Modal title="Créer une room" icon={<Plus size={20} />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="rn">Nom de la room</label>
          <input id="rn" className="input" placeholder="Ex : Tana Express" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="rm">Carte (mapId)</label>
            <input id="rm" className="input" value={mapId} onChange={(e) => setMapId(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rb">Bus (busId)</label>
            <input id="rb" className="input" value={busId} onChange={(e) => setBusId(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="rx">Joueurs max : <span className="text-brand-400">{max}</span></label>
          <input id="rx" type="range" min={2} max={64} value={max} onChange={(e) => setMax(Number(e.target.value))} className="w-full accent-amber-400" />
        </div>
        <button type="button" onClick={() => setPriv(!priv)} className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${priv ? 'border-brand-500/50 bg-brand-500/10' : 'border-white/10 bg-white/5'}`}>
          <Lock size={18} className={priv ? 'text-brand-400' : 'text-slate-500'} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">Room privée</div>
            <div className="text-xs text-slate-400">Protégée par un mot de passe</div>
          </div>
          <div className={`h-6 w-11 rounded-full p-0.5 transition ${priv ? 'bg-brand-500' : 'bg-white/15'}`}>
            <div className={`h-5 w-5 rounded-full bg-white transition ${priv ? 'translate-x-5' : ''}`} />
          </div>
        </button>
        {priv && (
          <div className="animate-pop">
            <label className="label" htmlFor="rp">Mot de passe</label>
            <div className="relative">
              <KeyRound size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input id="rp" className="input pl-11" type="text" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={50} />
            </div>
          </div>
        )}
        {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}
        <button className="btn-primary w-full py-3.5" disabled={busy}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Créer et entrer
        </button>
      </form>
    </Modal>
  );
}

function JoinModal({ room, onClose }: { room: RoomInfo; onClose: () => void }) {
  const { joinRoom } = useGame();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPw = room.hasPassword;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    const err = await joinRoom(room.id, password);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal title={`Rejoindre « ${room.name} »`} icon={<Users size={20} />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <span className="chip"><Crown size={12} className="text-brand-400" />{room.hostUsername}</span>
          <span className="chip"><Users size={12} />{room.playerCount}/{room.maxPlayers}</span>
          <span className="chip"><MapIcon size={12} />{room.mapId}</span>
        </div>
        {needsPw && (
          <div>
            <label className="label" htmlFor="jp">Mot de passe de la room</label>
            <div className="relative">
              <Lock size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input id="jp" className="input pl-11" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </div>
          </div>
        )}
        {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}
        <button className="btn-primary w-full py-3.5" disabled={busy || (needsPw && !password)}>
          {busy && <Loader2 size={18} className="animate-spin" />} Entrer dans la room
        </button>
      </form>
    </Modal>
  );
}
