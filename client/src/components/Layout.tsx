import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import TopNavigation from './TopNavigation';
import DesktopSidebar from './DesktopSidebar';
import BottomNavigation from './BottomNavigation';
import PushNotification from './PushNotification';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { isAuthenticated } = useAuth();
  const isMobile = useIsMobile();

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <TopNavigation />
        <main className="flex-1 pb-28 overflow-y-auto">
          {children}
        </main>
        <BottomNavigation />
        <PushNotification />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNavigation />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <PushNotification />
    </div>
  );
}
