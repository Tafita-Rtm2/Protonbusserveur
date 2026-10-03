import type { AccessKey, AdminStats, User } from './types';

type ApiResult<T = unknown> = T & {
  error?: string;
  locked?: boolean;
  remainingMs?: number;
  attemptsRemaining?: number;
};

async function request<T = any>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/proxy/${path}`, {
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || 'Erreur de communication.', ...data } as any;
    return data;
  } catch {
    return { error: 'Impossible de joindre le serveur.' } as any;
  }
}

export const api = {
  loginKey: (key: string) =>
    request<{ token: string; user: User }>('login-key', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  adminLogin: (adminCode: string) =>
    request<{ token: string }>('admin/login', {
      method: 'POST',
      body: JSON.stringify({ adminCode }),
    }),

  adminGenerateKey: (token: string, playerName: string, duration: string) =>
    request<{ key: AccessKey }>('admin/keys/generate', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ playerName, duration }),
    }),

  adminGetKeys: (token: string) =>
    request<{ keys: AccessKey[] }>('admin/keys', {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }),

  adminDeleteKey: (token: string, id: string) =>
    request<{ message: string }>(`admin/keys/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }),

  adminGetStats: (token: string) =>
    request<AdminStats>('admin/stats', {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }),

  async me(token: string): Promise<User | null> {
    try {
      const res = await fetch('/api/proxy/me', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()).user ?? null;
    } catch {
      return null;
    }
  },
};
