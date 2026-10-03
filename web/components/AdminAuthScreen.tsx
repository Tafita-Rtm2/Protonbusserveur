'use client';
import { useState } from 'react';
import { ArrowRight, Loader2, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useGame } from '@/lib/GameProvider';
import { Logo } from './Logo';

export function AdminAuthScreen() {
  const { loginAdmin } = useGame();
  const [adminCode, setAdminCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = adminCode.trim();
    if (!code) return setError('Veuillez saisir le code administrateur.');

    setBusy(true);
    const res = await loginAdmin(code);
    setBusy(false);

    if (res.error) {
      setError(res.error);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <Logo size={48} withText />
      </div>

      <div className="glass-strong p-7 shadow-2xl sm:p-8 rounded-2xl border border-amber-500/20">
        <h2 className="text-2xl font-bold text-white flex items-center justify-center gap-2">
          <ShieldCheck size={24} className="text-amber-400" /> Administration Secrète
        </h2>
        <p className="mb-6 mt-1 text-center text-sm text-slate-400">
          Zone réservée à l'administrateur. Saisissez votre code d'accès de sécurité.
        </p>

        <form onSubmit={handleAdminSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="ac">Code Administrateur</label>
            <div className="relative">
              <Lock size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                id="ac"
                type="password"
                className="input pl-11"
                placeholder="••••••••••••••••"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                maxLength={100}
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

          <button className="btn-primary w-full py-3.5 text-base" disabled={busy || !adminCode.trim()}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            {busy ? 'Vérification…' : 'Accéder au Dashboard Admin'}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        Sécurité maximale : 4 tentatives infructueuses entraînent un blocage automatique d'1 heure par IP.
      </p>
    </main>
  );
}
