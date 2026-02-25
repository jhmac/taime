import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const employeeNavItems = [
  { path: '/', icon: 'fas fa-home', label: 'Homebase' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedule' },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Money' },
  { path: '/messages', icon: 'fas fa-comment', label: 'Messages', badge: true },
  { path: '/more', icon: 'fas fa-bars', label: 'More' },
];

const adminNavItems = [
  { path: '/', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
  { path: '/tasks', icon: 'fas fa-clipboard-list', label: 'Tasks' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedule' },
  { path: '/messages', icon: 'fas fa-comment', label: 'Messages', badge: true },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Payroll' },
];

export default function BottomNavigation() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';
  const navItems = isAdmin ? adminNavItems : employeeNavItems;

  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.count || 0;

  const isActive = (path: string) => {
    if (path === '/') return location === '/';
    if (path === '/more') {
      return ['/more', '/requests', '/team-directory', '/employee-settings', '/support', '/profile'].includes(location);
    }
    return location === path || location.startsWith(path + '/');
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 safe-area-bottom" data-testid="bottom-navigation">
      <div className="flex items-center justify-around py-1">
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-col items-center py-2 px-3 transition-colors min-w-0 flex-1 relative",
                active
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <div className="relative">
                <i className={cn(item.icon, "text-lg")}></i>
                {'badge' in item && item.badge && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[9px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-0.5">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-0.5 truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
