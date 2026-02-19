import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const employeeNavItems = [
  { path: '/', icon: 'fas fa-home', label: 'Homebase' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedule' },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Money' },
  { path: '/communication', icon: 'fas fa-comment', label: 'Messages' },
  { path: '/more', icon: 'fas fa-bars', label: 'More' },
];

const adminNavItems = [
  { path: '/', icon: 'fas fa-tachometer-alt', label: 'Dashboard' },
  { path: '/tasks', icon: 'fas fa-clipboard-list', label: 'Tasks' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedule' },
  { path: '/team', icon: 'fas fa-users', label: 'Team' },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Payroll' },
];

export default function BottomNavigation() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';
  const navItems = isAdmin ? adminNavItems : employeeNavItems;

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
                "flex flex-col items-center py-2 px-3 transition-colors min-w-0 flex-1",
                active
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <i className={cn(item.icon, "text-lg")}></i>
              <span className="text-[10px] mt-0.5 truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
