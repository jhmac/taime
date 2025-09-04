import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import TopNavigation from './TopNavigation';
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
      <TopNavigation />
      <main className="pt-4">
        {children}
      </main>
      <PushNotification />
    </div>
  );
}
