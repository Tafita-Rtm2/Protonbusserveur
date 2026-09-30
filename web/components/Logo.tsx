import { Bus } from 'lucide-react';

export function Logo({ size = 40, withText = false }: { size?: number; withText?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand-300 to-brand-600 text-ink-950 shadow-glow"
        style={{ width: size, height: size }}
      >
        <Bus size={size * 0.55} strokeWidth={2.4} />
      </div>
      {withText && (
        <div className="leading-tight">
          <div className="text-lg font-extrabold tracking-tight text-white">Proton Bus</div>
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-brand-400">Multijoueur</div>
        </div>
      )}
    </div>
  );
}
