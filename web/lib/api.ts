import type { User } from './types';

type AuthResult = { token?: string; user?: User; error?: string };

async function post(path: string, body: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(`/api/proxy/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || 'Erreur de connexion au serveur.' };
    return data;
  } catch {
    return { error: 'Impossible de joindre le serveur.' };
  }
}

export const api = {
  login: (username: string, password: string) => post('login', { username, password }),
  register: (username: string, password: string) => post('register', { username, password }),

  async me(token: string): Promise<User | null> {
    try {
      const res = await fetch('/api/proxy/me', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()).user ?? null;
    } catch {
      return null;
    }
  }
};
