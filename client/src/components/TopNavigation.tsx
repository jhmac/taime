import { UserButton } from '@clerk/clerk-react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLocation } from 'wouter';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/schedules': 'Schedules',
  '/availability': 'Availability',
  '/tasks': 'Tasks & Chores',
  '/communication': 'Messages',
  '/team': 'Team',
  '/payroll': 'Payroll',
  '/hr': 'HR Management',
  '/hr/roles': 'Role Management',
  '/operations': 'Operations',
  '/admin': 'Settings',
};

export default function TopNavigation() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [location] = useLocation();

  const pageTitle = pageTitles[location] || 'ManAIger';

  if (isMobile) {
    return (
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <i className="fas fa-clock text-primary-foreground text-xs"></i>
            </div>
            <h1 className="text-base font-semibold">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative p-1.5" data-testid="notifications-button">
              <i className="fas fa-bell text-muted-foreground"></i>
            </button>
            {user && <UserButton afterSignOutUrl="/" />}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-6">
        <div>
          <h1 className="text-lg font-semibold">{pageTitle}</h1>
        </div>
        <div className="flex items-center gap-4">
          <button className="relative p-2 rounded-lg hover:bg-muted transition-colors" data-testid="notifications-button">
            <i className="fas fa-bell text-muted-foreground"></i>
          </button>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {user.firstName} {user.lastName}
              </span>
              <UserButton afterSignOutUrl="/" />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
