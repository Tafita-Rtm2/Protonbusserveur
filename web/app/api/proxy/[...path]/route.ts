import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Seules ces routes du serveur de jeu sont joignables depuis le site.
const ALLOWED = new Set(['login', 'register', 'me']);

async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  const target = (params.path || []).join('/');
  if (!ALLOWED.has(target)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const base = process.env.GAME_SERVER_URL?.replace(/\/$/, '');
  if (!base) return NextResponse.json({ error: 'Serveur non configuré (GAME_SERVER_URL).' }, { status: 500 });

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
      body: req.method === 'GET' ? undefined : await req.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: 'Le serveur de jeu ne répond pas (il se réveille peut-être, réessaie dans 30 s).' }, { status: 502 });
  }
}

export { handler as GET, handler as POST };
