'use client';
import { useEffect, useRef, useState } from 'react';
import { ClipboardCopy, Trash2 } from 'lucide-react';
import { android } from '@/lib/android';
import { Modal } from './Modal';
import { ScrollText } from 'lucide-react';

/** Logs natifs de l'APK (équivalent du bouton « Voir les logs » de l'ancien index.html). */
export function LogsModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const refresh = () => {
      const el = box.current;
      const atBottom = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
      setText(android.getLogs());
      if (atBottom) requestAnimationFrame(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; });
    };
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('✅ Logs copiés dans le presse-papiers.'); }
    catch {
      try { box.current?.select(); document.execCommand('copy'); setMsg('✅ Logs copiés dans le presse-papiers.'); }
      catch { setMsg('⚠️ Copie impossible, sélectionne le texte manuellement.'); }
    }
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <Modal title="Logs de l'application" icon={<ScrollText size={20} />} onClose={onClose}>
      <textarea ref={box} readOnly value={text} className="input h-72 resize-none font-mono text-xs" />
      {msg && <p className="mt-2 text-xs text-emerald-300">{msg}</p>}
      <div className="mt-4 flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => { android.clearLogs(); setText(android.getLogs()); }}><Trash2 size={16} />Effacer</button>
        <button className="btn-ghost flex-1" onClick={copy}><ClipboardCopy size={16} />Copier</button>
        <button className="btn-primary flex-1" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
