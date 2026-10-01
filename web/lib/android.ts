/**
 * Pont avec l'application Android (Launcher Proton Bus Sync) — mêmes appels que l'ancien index.html :
 *  - window.AndroidHost.launchGame(json)   : lance le jeu
 *  - window.AndroidHost.getLogs/clearLogs  : logs natifs
 *  - window.ProtonSync.setUserData(...)    : ancien Launcher (repli)
 */
type AndroidHostT = { launchGame?: (json: string) => void; getLogs?: () => string; clearLogs?: () => void };
type ProtonSyncT = { setUserData?: (pseudo: string, roomId: string, mapId: string, busId: string) => void };

declare global {
  interface Window { AndroidHost?: AndroidHostT; ProtonSync?: ProtonSyncT }
}

export type LaunchConfig = {
  pseudo: string; roomId: string; mapId: string; busId: string;
  serverUrl: string; showNameTag: boolean; showVoiceIcon: boolean;
};

const host = () => (typeof window === 'undefined' ? undefined : window.AndroidHost);

export const android = {
  canLaunch: () => typeof host()?.launchGame === 'function' || typeof window?.ProtonSync?.setUserData === 'function',
  hasLogs: () => typeof host()?.getLogs === 'function',
  getLogs: () => { try { return host()?.getLogs?.() ?? ''; } catch { return ''; } },
  clearLogs: () => { try { host()?.clearLogs?.(); } catch { /* ignore */ } },

  /** Le jeu reçoit l'URL du SITE (Vercel) : jamais celle de Hugging Face. */
  launch(cfg: Omit<LaunchConfig, 'serverUrl' | 'showNameTag' | 'showVoiceIcon'>): boolean {
    const full: LaunchConfig = { ...cfg, serverUrl: window.location.origin, showNameTag: true, showVoiceIcon: true };
    if (typeof host()?.launchGame === 'function') { host()!.launchGame!(JSON.stringify(full)); return true; }
    if (typeof window.ProtonSync?.setUserData === 'function') {
      window.ProtonSync.setUserData(full.pseudo, full.roomId, full.mapId, full.busId);
      return true;
    }
    return false;
  },
};
