'use client';
import { X } from 'lucide-react';
import { useEffect } from 'react';

export function Modal({ title, icon, onClose, children }: { title: string; icon?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="glass-strong relative w-full max-w-md animate-pop p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center gap-3">
          {icon && <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">{icon}</div>}
          <h2 className="flex-1 text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="icon-btn" aria-label="Fermer"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
