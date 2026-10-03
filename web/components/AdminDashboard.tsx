'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Database,
  KeyRound,
  Loader2,
  LogOut,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { useGame } from '@/lib/GameProvider';
import { api } from '@/lib/api';
import type { AccessKey, AdminStats } from '@/lib/types';
import { Logo } from './Logo';

export function AdminDashboard() {
  const { token, logout, toast } = useGame();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Formulaire Génération
  const [playerName, setPlayerName] = useState('');
  const [duration, setDuration] = useState('7d');
  const [generating, setGenerating] = useState(false);
  const [createdKey, setCreatedKey] = useState<AccessKey | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAdminData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [statsRes, keysRes] = await Promise.all([
      api.adminGetStats(token),
      api.adminGetKeys(token),
    ]);
    if (statsRes && !statsRes.error) setStats(statsRes);
    if (keysRes && keysRes.keys) setKeys(keysRes.keys);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchAdminData();
    const timer = setInterval(fetchAdminData, 10000);
    return () => clearInterval(timer);
  }, [fetchAdminData]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const name = playerName.trim();
    if (!name) return toast('error', 'Le nom du joueur est requis.');

    setGenerating(true);
    setCreatedKey(null);
    const res = await api.adminGenerateKey(token, name, duration);
    setGenerating(false);

    if (res.error) {
      toast('error', res.error);
    } else if (res.key) {
      toast('success', `Clé générée pour ${res.key.playerName} !`);
      setCreatedKey(res.key);
      setPlayerName('');
      fetchAdminData();
    }
  }

  async function handleDeleteKey(keyId: string, name: string) {
    if (!token) return;
    if (!confirm(`Voulez-vous vraiment supprimer la clé de "${name}" ?`)) return;

    const res = await api.adminDeleteKey(token, keyId);
    if (res.error) {
      toast('error', res.error);
    } else {
      toast('success', 'Clé supprimée avec succès.');
      fetchAdminData();
    }
  }

  function copyToClipboard(keyStr: string, id: string) {
    navigator.clipboard.writeText(keyStr);
    setCopiedId(id);
    toast('info', 'Clé copiée dans le presse-papiers !');
    setTimeout(() => setCopiedId(null), 2000);
  }

  const filteredKeys = keys.filter(
    (k) =>
      k.playerName.toLowerCase().includes(search.toLowerCase()) ||
      k.keyCode.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-ink-950 text-white">
      {/* Header Admin */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">Administration</h1>
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/30">
                  <ShieldCheck size={14} className="inline mr-1 -mt-0.5" /> ADMIN
                </span>
              </div>
              <p className="text-xs text-slate-400">Gestion globale des clés et du serveur Proton Bus</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAdminData}
              className="glass p-2 text-slate-400 hover:text-white rounded-lg transition"
              title="Rafraîchir"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/20 transition"
            >
              <LogOut size={16} />
              <span>Déconnexion</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-8">
        {/* Cartes de Statistiques */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="glass p-5 rounded-2xl border border-white/10">
            <div className="flex items-center gap-3 text-amber-400">
              <KeyRound size={22} />
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Total Clés</span>
            </div>
            <div className="mt-3 text-3xl font-extrabold text-white">{stats ? stats.totalKeys : '—'}</div>
          </div>

          <div className="glass p-5 rounded-2xl border border-white/10">
            <div className="flex items-center gap-3 text-emerald-400">
              <Users size={22} />
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Actifs en Direct</span>
            </div>
            <div className="mt-3 text-3xl font-extrabold text-white">{stats ? stats.activeKeysCount : '—'}</div>
          </div>

          <div className="glass p-5 rounded-2xl border border-white/10">
            <div className="flex items-center gap-3 text-cyan-400">
              <Users size={22} />
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Salons Actifs</span>
            </div>
            <div className="mt-3 text-3xl font-extrabold text-white">{stats ? stats.totalRooms : '—'}</div>
          </div>

          <div className="glass p-5 rounded-2xl border border-white/10">
            <div className="flex items-center gap-3 text-purple-400">
              <Database size={22} />
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">Stockage BDD</span>
            </div>
            <div className="mt-3 text-xl font-bold uppercase text-white">{stats ? stats.db : '—'}</div>
          </div>
        </div>

        {/* Section Génération de Clé */}
        <section className="glass-strong p-6 rounded-2xl border border-amber-500/20 shadow-xl">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <PlusCircle className="text-amber-400" size={20} />
            Générer une Nouvelle Clé d'Accès Unique
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Chaque clé est associée au nom d'un joueur. Une seule connexion simultanée est autorisée par clé.
          </p>

          <form onSubmit={handleGenerate} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3 items-end">
            <div>
              <label className="label" htmlFor="pname">Nom du Joueur</label>
              <input
                id="pname"
                className="input"
                placeholder="ex: Miantavola"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={24}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="dur">Durée de Validité</label>
              <select
                id="dur"
                className="input"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
                <option value="1h">1 Heure</option>
                <option value="24h">24 Heures (1 Jour)</option>
                <option value="7d">7 Jours</option>
                <option value="15d">15 Jours</option>
                <option value="30d">30 Jours</option>
                <option value="infinite">Infinie (Permanent)</option>
              </select>
            </div>

            <button type="submit" className="btn-primary py-3" disabled={generating || !playerName.trim()}>
              {generating ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}
              {generating ? 'Génération…' : 'Générer la Clé'}
            </button>
          </form>

          {createdKey && (
            <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-300 animate-pop flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase font-semibold text-emerald-400">Clé Générée avec succès :</div>
                <div className="text-xl font-mono font-extrabold text-white mt-1">{createdKey.keyCode}</div>
                <div className="text-xs text-slate-300 mt-1">Joueur : <strong>{createdKey.playerName}</strong></div>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(createdKey.keyCode, 'new')}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 text-ink-950 px-4 py-2 font-bold hover:bg-emerald-400 transition shrink-0"
              >
                {copiedId === 'new' ? <Check size={18} /> : <Copy size={18} />}
                {copiedId === 'new' ? 'Copié !' : 'Copier la clé'}
              </button>
            </div>
          )}
        </section>

        {/* Section Liste des Clés */}
        <section className="glass-strong p-6 rounded-2xl border border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-lg font-bold text-white">Liste des Clés d'Accès</h2>
              <p className="text-xs text-slate-400 mt-0.5">{keys.length} clé(s) enregistrée(s)</p>
            </div>

            <div className="relative w-full sm:w-72">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-10 text-sm"
                placeholder="Rechercher par joueur ou clé..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="pb-3 px-3">Nom du Joueur</th>
                  <th className="pb-3 px-3">Clé Unique</th>
                  <th className="pb-3 px-3">Statut</th>
                  <th className="pb-3 px-3">Expiration</th>
                  <th className="pb-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                      Aucune clé trouvée.
                    </td>
                  </tr>
                ) : (
                  filteredKeys.map((k) => {
                    const isExpired = k.isExpired || (k.expiresAt && k.expiresAt < Date.now());
                    return (
                      <tr key={k.id} className="hover:bg-white/5 transition">
                        <td className="py-3.5 px-3 font-semibold text-white">{k.playerName}</td>
                        <td className="py-3.5 px-3 font-mono text-amber-300 font-bold">
                          <div className="flex items-center gap-2">
                            <span>{k.keyCode}</span>
                            <button
                              onClick={() => copyToClipboard(k.keyCode, k.id)}
                              className="text-slate-500 hover:text-white transition"
                              title="Copier la clé"
                            >
                              {copiedId === k.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-3">
                          {k.isActive ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                              En ligne (Actif)
                            </span>
                          ) : isExpired ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-400 border border-rose-500/30">
                              Expirée
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 border border-slate-700">
                              Disponible
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-slate-400 text-xs">
                          {k.expiresAt ? new Date(k.expiresAt).toLocaleString('fr-FR') : 'Infinie (Permanent)'}
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <button
                            onClick={() => handleDeleteKey(k.id, k.playerName)}
                            className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition"
                            title="Supprimer la clé"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
