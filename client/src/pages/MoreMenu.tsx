import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useClerk } from '@clerk/clerk-react';
import { Card, CardContent } from '@/components/ui/card';

interface MenuItem {
  icon: string;
  label: string;
  subtitle?: string;
  path?: string;
  action?: () => void;
  iconColor?: string;
}

export default function MoreMenu() {
  const { user } = useAuth();
  const { signOut } = useClerk();
  const [, navigate] = useLocation();

  const initials = `${(user?.firstName || '')[0] || ''}${(user?.lastName || '')[0] || ''}`.toUpperCase();

  const menuItems: MenuItem[] = [
    { icon: 'fas fa-user', label: 'Profile', path: '/employee-settings', iconColor: 'text-muted-foreground' },
    { icon: 'fas fa-file-alt', label: 'Requests', subtitle: 'Time Off, Trade, Cover, Availability...', path: '/requests', iconColor: 'text-muted-foreground' },
    { icon: 'fas fa-users', label: 'Team', path: '/team-directory', iconColor: 'text-muted-foreground' },
    { icon: 'fas fa-bolt', label: 'Cash Out', path: '/payroll', iconColor: 'text-muted-foreground' },
    { icon: 'fas fa-sliders-h', label: 'Settings', subtitle: 'Calendar Sync, Notifications & Alerts, Sign Out...', path: '/employee-settings', iconColor: 'text-muted-foreground' },
    { icon: 'fas fa-video', label: 'Improvements', subtitle: 'Share 60-second improvement videos', path: '/improvements', iconColor: 'text-orange-500' },
    { icon: 'fas fa-exclamation-triangle', label: 'Report Issue', subtitle: 'Log a problem for your manager', path: '/issues', iconColor: 'text-amber-500' },
    { icon: 'fas fa-question-circle', label: 'Support', path: '/support', iconColor: 'text-muted-foreground' },
  ];

  const pin = String(Math.abs(hashCode(user?.id || 'default'))).slice(0, 6).padStart(6, '0');

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 p-4 pb-2">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
          {user?.profileImageUrl ? (
            <img src={user.profileImageUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold">More</h1>
        </div>
      </div>

      <div className="px-4 space-y-0">
        {menuItems.map((item, i) => (
          <button
            key={i}
            onClick={() => item.action ? item.action() : item.path && navigate(item.path)}
            className="w-full flex items-center gap-4 py-4 border-b border-border text-left hover:bg-muted/30 transition-colors"
          >
            <i className={`${item.icon} w-6 text-center text-lg ${item.iconColor || 'text-muted-foreground'}`}></i>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              {item.subtitle && (
                <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
              )}
            </div>
            <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
          </button>
        ))}
      </div>

      <div className="px-4 mt-6">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-xs text-muted-foreground mb-1">Your Taime Clock PIN</div>
            <div className="text-3xl font-bold tracking-widest font-mono">{pin}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
