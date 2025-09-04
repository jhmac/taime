import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import BottomNavigation from './BottomNavigation';
import PushNotification from './PushNotification';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="max-w-sm mx-auto bg-white shadow-2xl min-h-screen relative overflow-hidden">
      <main className="pb-20">
        {children}
      </main>
      <BottomNavigation />
      <PushNotification />
    </div>
  );
}
