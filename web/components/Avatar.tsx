const COLORS = ['#f59e0b', '#10b981', '#6366f1', '#ec4899', '#06b6d4', '#f43f5e', '#8b5cf6', '#84cc16'];

export function Avatar({ name, size = 40, speaking = false }: { name: string; size?: number; speaking?: boolean }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const color = COLORS[h % COLORS.length];
  return (
    <div
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white transition ${speaking ? 'animate-ring ring-2 ring-emerald-400' : ''}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}99)`, fontSize: size * 0.42 }}
    >
      {(name[0] || '?').toUpperCase()}
    </div>
  );
}
