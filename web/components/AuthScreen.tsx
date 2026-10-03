'use client';
import { useState } from 'react';
import { ArrowRight, KeyRound, Loader2, Mic, ShieldAlert, Users } from 'lucide-react';
import { useGame } from '@/lib/GameProvider';
import { Logo } from './Logo';

const FEATURES = [
  { icon: KeyRound, title: 'Clé d\'Accès Unique', text: 'Entrez votre clé fournie par l\'administrateur pour rejoindre le serveur.' },
  { icon: Users, title: 'Salons Multijoueur', text: 'Créez ou rejoignez des convois multijoueurs en temps réel.' },
  { icon: Mic, title: 'Vocal P2P Intégré', text: 'Discutez en direct de haute qualité avec les autres chauffeurs.' },
];

export function AuthScreen() {
  const { loginWithKey } = useGame();
  const [accessKey, setAccessKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const key = accessKey.trim();
    if (!key) return setError('Veuillez saisir votre clé d\'accès.');

    setBusy(true);
    const res = await loginWithKey(key);
    setBusy(false);

    if (res.error) {
      setError(res.error);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
      {/* Présentation */}
      <section className="hidden lg:block">
        <Logo size={56} withText />
        <h1 className="mt-10 text-5xl font-extrabold leading-[1.1] tracking-tight text-white">
          Proton Bus Sync.<br />
          <span className="bg-gradient-to-r from-amber-300 to-amber-500 bg-clip-text text-transparent">
            Conduisez ensemble.
          </span>
        </h1>
        <p className="mt-5 max-w-md text-lg text-slate-400">
          Entrez votre clé d'accès unique pour vous connecter au serveur multijoueur Proton Bus Simulator.
        </p>

        <ul className="mt-10 space-y-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="glass flex items-center gap-4 p-4 rounded-xl border border-white/5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                <Icon size={22} />
              </div>
              <div>
                <div className="font-semibold text-white">{title}</div>
                <div className="text-sm text-slate-400">{text}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Formulaire Clé Joueur */}
      <section className="mx-auto w-full max-w-md">
        <div className="mb-8 lg:hidden"><Logo size={48} withText /></div>

        <div className="glass-strong p-7 shadow-2xl sm:p-8 rounded-2xl border border-white/10">
          <h2 className="text-2xl font-bold text-white">Connexion par Clé 🚌</h2>
          <p className="mb-6 mt-1 text-sm text-slate-400">
            Saisissez la clé d'accès unique fournie par votre administrateur.
          </p>

          <form onSubmit={handleKeySubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="k">Clé d'Accès Joueur</label>
              <div className="relative">
                <KeyRound size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="k"
                  className="input pl-11 font-mono uppercase tracking-wider text-amber-300 font-bold"
                  placeholder="KEY-XXXX-XXXX"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value.toUpperCase())}
                  maxLength={60}
                  autoFocus
                  required
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="animate-pop rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 flex items-start gap-2">
                <ShieldAlert size={18} className="shrink-0 mt-0.5 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <button className="btn-primary w-full py-3.5 text-base" disabled={busy || !accessKey.trim()}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
              {busy ? 'Vérification…' : 'Accéder au Serveur'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">
          Clé unique restreinte à un seul appareil actif à la fois.
        </p>
      </section>
    </main>
  );
}
