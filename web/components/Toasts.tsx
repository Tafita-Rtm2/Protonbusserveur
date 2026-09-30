'use client';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useGame } from '@/lib/GameProvider';

const STYLE = {
  info: { icon: Info, cls: 'border-sky-400/30 text-sky-200' },
  success: { icon: CheckCircle2, cls: 'border-emerald-400/30 text-emerald-200' },
  error: { icon: XCircle, cls: 'border-rose-400/30 text-rose-200' },
} as const;

export function Toasts() {
  const { toasts, dismissToast } = useGame();
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
      {toasts.map((t) => {
        const { icon: Icon, cls } = STYLE[t.kind];
        return (
          <div key={t.id} className={`pointer-events-auto glass-strong flex animate-slide items-start gap-3 border p-3.5 text-sm shadow-2xl ${cls}`}>
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-slate-100">{t.text}</p>
            <button onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-white" aria-label="Fermer"><X size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}
