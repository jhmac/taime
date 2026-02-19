import { useLocation } from 'wouter';
import { useClerk } from '@clerk/clerk-react';
import { useToast } from '@/hooks/use-toast';

interface SettingsItem {
  icon: string;
  label: string;
  subtitle?: string;
  action?: () => void;
  path?: string;
}

export default function EmployeeSettings() {
  const [, navigate] = useLocation();
  const { signOut } = useClerk();
  const { toast } = useToast();

  const handleSignOut = async () => {
    try {
      await signOut();
      window.location.href = '/';
    } catch {
      toast({ title: 'Error', description: 'Failed to sign out', variant: 'destructive' });
    }
  };

  const settingsItems: SettingsItem[] = [
    {
      icon: 'fas fa-map-marker-alt',
      label: 'Locations',
      subtitle: 'PINs and more...',
      action: () => toast({ title: 'Locations', description: 'Location settings coming soon.' }),
    },
    {
      icon: 'fas fa-calendar-check',
      label: 'Calendar Sync',
      subtitle: 'Disabled',
      action: () => toast({ title: 'Calendar Sync', description: 'Calendar sync coming soon.' }),
    },
    {
      icon: 'fas fa-bell',
      label: 'Notifications & Alerts',
      action: () => toast({ title: 'Notifications', description: 'Notification settings coming soon.' }),
    },
    {
      icon: 'fas fa-lock',
      label: 'Password & security',
      action: () => toast({ title: 'Security', description: 'Security settings are managed through your login provider.' }),
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={() => navigate('/more')} className="text-primary">
          <i className="fas fa-chevron-left text-lg"></i>
        </button>
        <h1 className="text-lg font-bold">Settings</h1>
        <div className="w-6"></div>
      </div>

      <div className="px-4">
        {settingsItems.map((item, i) => (
          <button
            key={i}
            onClick={item.action}
            className="w-full flex items-center gap-4 py-4 border-b border-border text-left hover:bg-muted/30 transition-colors"
          >
            <i className={`${item.icon} w-6 text-center text-lg text-muted-foreground`}></i>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              {item.subtitle && (
                <div className="text-xs text-muted-foreground">{item.subtitle}</div>
              )}
            </div>
            <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
          </button>
        ))}

        <div className="mt-2 border-t-4 border-border -mx-4 px-4">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-4 py-4 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="w-6"></div>
            <div className="flex-1">
              <div className="text-sm font-medium">Sign Out</div>
            </div>
            <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
          </button>
        </div>
      </div>
    </div>
  );
}
