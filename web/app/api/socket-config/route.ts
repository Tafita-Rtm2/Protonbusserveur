import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Renvoie l'URL du serveur temps réel UNIQUEMENT si le token est valide.
 * L'URL reste dans les variables d'environnement Vercel : elle n'apparaît ni dans le code source
 * du site, ni dans le bundle JS, ni pour un visiteur non connecté.
 */
export async function GET(req: NextRequest) {
  const base = process.env.GAME_SERVER_URL?.replace(/\/$/, '');
  const auth = req.headers.get('authorization');
  if (!base || !auth) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  try {
    const check = await fetch(`${base}/api/me`, {
      headers: { authorization: auth, 'x-proxy-key': process.env.API_PROXY_KEY || '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!check.ok) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    return NextResponse.json({ url: base }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Serveur injoignable' }, { status: 502 });
  }
}
