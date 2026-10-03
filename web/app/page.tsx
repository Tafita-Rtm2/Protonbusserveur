'use client';
import { GameProvider, useGame } from '@/lib/GameProvider';
import { AuthScreen } from '@/components/AuthScreen';
import { Lobby } from '@/components/Lobby';
import { RoomView } from '@/components/RoomView';
import { Toasts } from '@/components/Toasts';
import { Logo } from '@/components/Logo';

function App() {
  const { booting, user, roomId } = useGame();

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-float"><Logo size={64} /></div>
      </div>
    );
  }
  if (!user || user.role === 'admin') return <AuthScreen />;
  return roomId ? <RoomView /> : <Lobby />;
}

export default function Page() {
  return (
    <GameProvider>
      <App />
      <Toasts />
    </GameProvider>
  );
}
