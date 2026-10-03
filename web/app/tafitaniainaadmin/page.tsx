'use client';
import { GameProvider, useGame } from '@/lib/GameProvider';
import { AdminAuthScreen } from '@/components/AdminAuthScreen';
import { AdminDashboard } from '@/components/AdminDashboard';
import { Toasts } from '@/components/Toasts';
import { Logo } from '@/components/Logo';

function AdminApp() {
  const { booting, user } = useGame();

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <div className="animate-float"><Logo size={64} /></div>
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return <AdminAuthScreen />;
  }

  return <AdminDashboard />;
}

export default function TafitaniainaAdminPage() {
  return (
    <GameProvider>
      <AdminApp />
      <Toasts />
    </GameProvider>
  );
}
