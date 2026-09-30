import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Proton Bus — Multijoueur',
  description: 'Crée ou rejoins une room, discute en vocal et conduis avec tes amis.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#070a12', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
