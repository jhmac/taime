import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', icon: 'fas fa-home', label: 'Dashboard' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedules' },
  { path: '/availability', icon: 'fas fa-clock', label: 'Available' },
  { path: '/team', icon: 'fas fa-users', label: 'Team' },
  { path: '/communication', icon: 'fas fa-comment', label: 'Chat' },
];

export default function BottomNavigation() {
  const [location, navigate] = useLocation();

  return (
    <nav className="absolute bottom-0 left-0 right-0 bg-card border-t border-border" data-testid="bottom-navigation">
      <div className="flex items-center justify-around py-2">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              "flex flex-col items-center py-2 px-3 transition-colors",
              location === item.path
                ? "text-primary"
                : "text-muted-foreground hover:text-primary"
            )}
            data-testid={`nav-${item.label.toLowerCase()}`}
          >
            <i className={`${item.icon} text-lg`}></i>
            <span className="text-xs mt-1">{item.label}</span>
            {item.label === 'More' && (
              <span className="absolute -top-1 -right-1 bg-destructive w-2 h-2 rounded-full"></span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
