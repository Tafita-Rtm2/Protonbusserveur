/** @type {import('next').NextConfig} */

// Ces valeurs sont lues AU BUILD sur Vercel (Environment Variables). Elles ne sont jamais envoyées au navigateur.
const GAME = (process.env.GAME_SERVER_URL || '').replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  skipTrailingSlashRedirect: true, // socket.io appelle "/socket.io/" : pas de redirection 308
  async rewrites() {
    const rules = [{ source: '/launcher', destination: '/' }]; // l'APK charge <url>/launcher
    if (GAME) {
      // Le navigateur ET le jeu parlent à https://ton-site.vercel.app/socket.io ;
      // Vercel relaie vers Hugging Face. L'URL HF n'apparaît nulle part côté client.
      const dest = `${GAME}/socket.io`;
      rules.push({ source: '/socket.io', destination: `${dest}/` });
      rules.push({ source: '/socket.io/:path*', destination: `${dest}/:path*` });
    } else {
      console.warn('[web] GAME_SERVER_URL absent au build : le temps réel ne sera pas relayé.');
    }
    return rules;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default nextConfig;
