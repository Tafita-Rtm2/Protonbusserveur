import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function isAllowedRoute(target: string): boolean {
  if (target === 'login-key' || target === 'me') return true;
  if (target === 'admin/login' || target === 'admin/keys/generate' || target === 'admin/keys' || target === 'admin/stats') return true;
  if (target.startsWith('admin/keys/')) return true;
  return false;
}

async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  const target = (params.path || []).join('/');
  if (!isAllowedRoute(target)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const base = process.env.GAME_SERVER_URL?.replace(/\/$/, '') || 'http://localhost:7860';

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-proxy-key': process.env.API_PROXY_KEY || '',
    'x-client-ip': ip,
  };
  const auth = req.headers.get('authorization');
  if (auth) headers.authorization = auth;

  try {
    const upstream = await fetch(`${base}/api/${target}`, {
      method: req.method,
      headers,
      body: (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') ? undefined : await req.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: 'Le serveur de jeu ne répond pas (il se réveille peut-être, réessaie dans 30 s).' }, { status: 502 });
  }
}

export { handler as GET, handler as POST, handler as DELETE };
