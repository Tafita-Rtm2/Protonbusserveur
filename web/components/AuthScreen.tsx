'use client';
import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, LogIn, Mic, ShieldCheck, User, UserPlus, Users } from 'lucide-react';
import { useGame } from '@/lib/GameProvider';
import { Logo } from './Logo';

const FEATURES = [
  { icon: Users, title: 'Rooms multijoueur', text: 'Crée ta room ou rejoins tes amis en un clic.' },
  { icon: Mic, title: 'Vocal intégré', text: 'Discute en direct avec tous les joueurs de la room.' },
  { icon: ShieldCheck, title: 'Compte sécurisé', text: 'Ton pseudo est unique et te suit dans le jeu.' },
];

export function AuthScreen() {
  const { login, register } = useGame();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === 'register';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = username.trim();
    if (isRegister) {
      if (name.length < 3) return setError('Le pseudo doit contenir au moins 3 caractères.');
      if (password.length < 6) return setError('Le mot de passe doit contenir au moins 6 caractères.');
      if (password !== confirm) return setError('Les mots de passe ne correspondent pas.');
    }
    setBusy(true);
    const err = await (isRegister ? register(name, password) : login(name, password));
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
      {/* Présentation */}
      <section className="hidden lg:block">
        <Logo size={56} withText />
        <h1 className="mt-10 text-5xl font-extrabold leading-[1.1] tracking-tight text-white">
          Conduis ensemble.<br />
          <span className="bg-gradient-to-r from-brand-300 to-brand-500 bg-clip-text text-transparent">Parle en direct.</span>
        </h1>
        <p className="mt-5 max-w-md text-lg text-slate-400">
          Le hub multijoueur de Proton Bus Simulator : crée un compte, monte une room et prends la route avec ta bande.
        </p>
        <ul className="mt-10 space-y-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="glass flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400"><Icon size={22} /></div>
              <div>
                <div className="font-semibold text-white">{title}</div>
                <div className="text-sm text-slate-400">{text}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Formulaire */}
      <section className="mx-auto w-full max-w-md">
        <div className="mb-8 lg:hidden"><Logo size={48} withText /></div>
        <div className="glass-strong p-7 shadow-2xl sm:p-8">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-ink-950/60 p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${
                  mode === m ? 'bg-brand-500 text-ink-950 shadow-glow' : 'text-slate-400 hover:text-white'
                }`}
              >
                {m === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
                {m === 'login' ? 'Connexion' : 'Créer un compte'}
              </button>
            ))}
          </div>

          <h2 className="text-2xl font-bold text-white">{isRegister ? 'Bienvenue à bord 🚌' : 'Content de te revoir'}</h2>
          <p className="mb-6 mt-1 text-sm text-slate-400">
            {isRegister ? 'Choisis ton pseudo : c’est le nom que verront les autres joueurs en jeu.' : 'Connecte-toi pour accéder aux rooms.'}
          </p>

          <form onSubmit={submit} className="space-y-4" autoComplete="on">
            <div>
              <label className="label" htmlFor="u">Pseudo</label>
              <div className="relative">
                <User size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input id="u" className="input pl-11" placeholder="Ton pseudo" value={username} onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username" maxLength={20} autoFocus />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="p">Mot de passe</label>
              <div className="relative">
                <Lock size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input id="p" className="input pl-11 pr-11" type={show ? 'text' : 'password'} placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete={isRegister ? 'new-password' : 'current-password'} maxLength={100} />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-2.5 top-1/2 -translate-y-1/2 icon-btn" aria-label="Afficher le mot de passe">
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {isRegister && (
              <div className="animate-pop">
                <label className="label" htmlFor="c">Confirmer le mot de passe</label>
                <div className="relative">
                  <Lock size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input id="c" className="input pl-11" type={show ? 'text' : 'password'} placeholder="••••••••" value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={100} />
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="animate-pop rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
            )}

            <button className="btn-primary w-full py-3.5 text-base" disabled={busy || !username || !password}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
              {busy ? 'Un instant…' : isRegister ? 'Créer mon compte' : 'Se connecter'}
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-slate-500">Ton compte est le même dans le jeu et sur le site.</p>
      </section>
    </main>
  );
}
