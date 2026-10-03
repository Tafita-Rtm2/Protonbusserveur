'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Ban, Bus, Check, Copy, Crown, DoorOpen, Headphones, Loader2, Lock, Map as MapIcon, MessageCircle, Mic, MicOff,
  Phone, PhoneOff, Send, ShieldAlert, Trash2, UserMinus, Users, Volume2,
} from 'lucide-react';
import { useGame } from '@/lib/GameProvider';
import { useVoice } from '@/lib/useVoice';
import type { Member } from '@/lib/types';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
import { Modal } from './Modal';

type Confirm = { kind: 'kick' | 'ban' | 'close'; member?: Member } | null;

export function RoomView() {
  const { socket, room, roomId, members, bans, chat, isHost, leaveRoom, kick, ban, unban, closeRoom, sendChat } = useGame();
  const voice = useVoice(socket, roomId);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const me = socket?.id;

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length]);

  const copyId = async () => {
    try { await navigator.clipboard.writeText(room?.name || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const submitChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendChat(text);
    setText('');
  };

  const sorted = [...members].sort((a, b) => Number(b.socketId === room?.hostId) - Number(a.socketId === room?.hostId));

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 pt-5 sm:px-6">
      {/* En-tête */}
      <header className="glass flex flex-wrap items-center gap-3 px-4 py-3">
        <Logo size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-bold text-white">{room?.name ?? 'Room'}</h1>
            {room?.isPrivate && <Lock size={15} className="shrink-0 text-amber-300" />}
            <button onClick={copyId} className="icon-btn" title="Copier le nom">{copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}</button>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1"><MapIcon size={12} />{room?.mapId}</span>
            <span className="flex items-center gap-1"><Bus size={12} />{room?.busId}</span>
            <span className="flex items-center gap-1"><Users size={12} />{members.length}/{room?.maxPlayers}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isHost && (
            <>
              <button onClick={() => setConfirm({ kind: 'close' })} className="btn-danger"><Trash2 size={16} /><span className="hidden sm:inline">Détruire la room</span></button>
            </>
          )}
          <button onClick={leaveRoom} className="btn-ghost"><DoorOpen size={16} />Quitter</button>
        </div>
      </header>

      <div className="mt-5 grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Colonne gauche : joueurs + vocal */}
        <div className="space-y-5">
          <section className="glass p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold text-white"><Users size={18} className="text-brand-400" />Joueurs <span className="text-slate-500">({members.length})</span></h2>
            </div>
            <ul className="space-y-2">
              {sorted.map((m) => {
                const isRoomHost = m.socketId === room?.hostId;
                const isMe = m.socketId === me;
                const talking = !!voice.speaking[m.socketId] && !(isMe && voice.muted) && !m.muted;
                return (
                  <li key={m.socketId} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
                    <Avatar name={m.username} size={42} speaking={talking} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-white">{m.username}</span>
                        {isMe && <span className="chip py-0 text-[10px]">toi</span>}
                        {isRoomHost && <Crown size={15} className="shrink-0 text-brand-400" aria-label="Créateur" />}
                      </div>
                      <div className="text-xs text-slate-500">{isRoomHost ? 'Créateur de la room' : 'Joueur'}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {m.inVoice ? (
                        m.muted ? <MicOff size={17} className="text-rose-400" aria-label="Micro coupé" />
                          : <Mic size={17} className={talking ? 'text-emerald-400' : 'text-slate-400'} aria-label="En vocal" />
                      ) : null}
                      {isHost && !isMe && (
                        <>
                          <button onClick={() => setConfirm({ kind: 'kick', member: m })} className="icon-btn hover:!text-amber-300" title="Expulser"><UserMinus size={17} /></button>
                          <button onClick={() => setConfirm({ kind: 'ban', member: m })} className="icon-btn hover:!text-rose-400" title="Bannir"><Ban size={17} /></button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Vocal */}
          <section className="glass p-5">
            <h2 className="mb-1 flex items-center gap-2 font-bold text-white"><Headphones size={18} className="text-brand-400" />Appel vocal</h2>
            <p className="mb-4 text-sm text-slate-400">
              {voice.joined ? 'Tu es en vocal avec la room.' : 'Parle en direct avec les joueurs de la room.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {!voice.joined ? (
                <button onClick={voice.join} disabled={voice.busy} className="btn-primary">
                  {voice.busy ? <Loader2 size={18} className="animate-spin" /> : <Phone size={18} />}Rejoindre le vocal
                </button>
              ) : (
                <>
                  <button onClick={voice.toggleMute} className={voice.muted ? 'btn-danger' : 'btn-ghost'}>
                    {voice.muted ? <MicOff size={18} /> : <Mic size={18} />}{voice.muted ? 'Micro coupé' : 'Micro actif'}
                  </button>
                  <button onClick={voice.leave} className="btn-danger"><PhoneOff size={18} />Quitter le vocal</button>
                </>
              )}
            </div>
            {voice.joined && <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Volume2 size={14} />Le cercle vert autour d’un joueur indique qu’il parle.</p>}
            {voice.error && <div role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{voice.error}</div>}
          </section>

          {/* Bannis (créateur) */}
          {isHost && bans.length > 0 && (
            <section className="glass p-5">
              <h2 className="mb-3 flex items-center gap-2 font-bold text-white"><ShieldAlert size={18} className="text-rose-400" />Joueurs bannis</h2>
              <ul className="space-y-2">
                {bans.map((b) => (
                  <li key={b.key} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                    <span className="font-medium text-slate-200">{b.name}</span>
                    <button onClick={() => unban(b.key)} className="btn-ghost px-3 py-1.5 text-xs">Débannir</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Colonne droite : chat */}
        <section className="glass flex h-[520px] flex-col p-5 lg:h-auto lg:min-h-[420px]">
          <h2 className="mb-3 flex items-center gap-2 font-bold text-white"><MessageCircle size={18} className="text-brand-400" />Discussion</h2>
          <div className="-mx-1 flex-1 space-y-2.5 overflow-y-auto px-1">
            {chat.length === 0 && <p className="pt-6 text-center text-sm text-slate-500">Aucun message. Dis bonjour 👋</p>}
            {chat.map((m) =>
              m.system ? (
                <p key={m.id} className="text-center text-xs italic text-slate-500">{m.text}</p>
              ) : (
                <div key={m.id} className={`flex gap-2.5 ${m.socketId === me ? 'flex-row-reverse' : ''}`}>
                  <Avatar name={m.username || '?'} size={30} />
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.socketId === me ? 'bg-brand-500 text-ink-950' : 'bg-white/10 text-slate-100'}`}>
                    {m.socketId !== me && <div className="mb-0.5 text-[11px] font-bold text-brand-300">{m.username}</div>}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                </div>
              )
            )}
            <div ref={chatEnd} />
          </div>
          <form onSubmit={submitChat} className="mt-3 flex gap-2">
            <input className="input" placeholder="Écrire un message…" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
            <button className="btn-primary px-4" disabled={!text.trim()} aria-label="Envoyer"><Send size={18} /></button>
          </form>
        </section>
      </div>

      {/* Confirmations */}
      {confirm && (
        <Modal
          title={confirm.kind === 'close' ? 'Détruire la room ?' : confirm.kind === 'ban' ? `Bannir ${confirm.member?.username} ?` : `Expulser ${confirm.member?.username} ?`}
          icon={confirm.kind === 'kick' ? <UserMinus size={20} /> : confirm.kind === 'ban' ? <Ban size={20} /> : <Trash2 size={20} />}
          onClose={() => setConfirm(null)}
        >
          <p className="mb-5 text-sm text-slate-400">
            {confirm.kind === 'close' && 'Tous les joueurs seront renvoyés au lobby et la room sera supprimée définitivement.'}
            {confirm.kind === 'kick' && 'Le joueur sera renvoyé au lobby mais pourra rejoindre à nouveau.'}
            {confirm.kind === 'ban' && 'Le joueur sera expulsé et ne pourra plus rejoindre cette room. Tu pourras le débannir depuis la liste.'}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setConfirm(null)}>Annuler</button>
            <button
              className="btn-danger flex-1"
              onClick={() => {
                if (confirm.kind === 'close') closeRoom();
                else if (confirm.member) (confirm.kind === 'ban' ? ban : kick)(confirm.member.socketId);
                setConfirm(null);
              }}
            >
              Confirmer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
