import { useState } from 'react';
import { useLocation } from 'wouter';
import { useClerk } from '@clerk/clerk-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface SettingsRow {
  icon: string;
  label: string;
  subtitle?: string;
  badge?: string;
  action: () => void;
  chevron?: boolean;
  danger?: boolean;
}

function SettingsSection({ title, rows }: { title?: string; rows: SettingsRow[] }) {
  return (
    <div className="mb-2">
      {title && (
        <div className="px-4 pt-5 pb-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        </div>
      )}
      <div className="bg-card rounded-xl mx-4 overflow-hidden border border-border">
        {rows.map((row, i) => (
          <button
            key={i}
            onClick={row.action}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
              i < rows.length - 1 ? 'border-b border-border' : ''
            } ${row.danger ? 'hover:bg-red-50 dark:hover:bg-red-950/20' : 'hover:bg-muted/40'}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              row.danger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-primary/10'
            }`}>
              <i className={`${row.icon} text-sm ${row.danger ? 'text-red-500' : 'text-primary'}`}></i>
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${row.danger ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                {row.label}
              </div>
              {row.subtitle && (
                <div className="text-xs text-muted-foreground mt-0.5">{row.subtitle}</div>
              )}
            </div>
            {row.badge && (
              <Badge variant="secondary" className="text-xs">{row.badge}</Badge>
            )}
            {row.chevron !== false && (
              <i className={`fas fa-chevron-right text-xs ${row.danger ? 'text-red-400' : 'text-muted-foreground'}`}></i>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function EmployeeSettings() {
  const [, navigate] = useLocation();
  const { signOut, openUserProfile } = useClerk();
  const { user } = useAuth();
  const { toast } = useToast();

  const [showUnsubscribeDialog, setShowUnsubscribeDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const unsubscribeMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/account/unsubscribe'),
    onSuccess: () => {
      toast({ title: 'Unsubscribed', description: 'You will no longer receive push notifications from Taime.' });
      setShowUnsubscribeDialog(false);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to unsubscribe. Please try again.', variant: 'destructive' });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/account/self'),
    onSuccess: () => {
      toast({ title: 'Account deleted', description: 'Your account has been permanently removed.' });
      setTimeout(() => { window.location.href = '/'; }, 1500);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to delete account. Please try again.';
      toast({ title: 'Cannot delete account', description: msg, variant: 'destructive' });
      setShowDeleteDialog(false);
    },
  });

  const handleSignOut = async () => {
    try {
      await signOut();
      window.location.href = '/';
    } catch {
      toast({ title: 'Error', description: 'Failed to sign out', variant: 'destructive' });
    }
  };

  const roleName = user?.role?.displayName || user?.role?.name;

  return (
    <div className="min-h-screen bg-muted/30 dark:bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-background border-b border-border">
        <button onClick={() => navigate('/more')} className="p-1 -ml-1 text-primary">
          <i className="fas fa-chevron-left text-lg"></i>
        </button>
        <h1 className="text-base font-bold">Settings</h1>
        <div className="w-8" />
      </div>

      <div className="pb-safe pb-8">
        {/* User identity card */}
        <div className="mx-4 mt-5 mb-2 bg-card rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold flex-shrink-0">
            {user?.firstName?.[0] ?? user?.email?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-foreground truncate">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="text-sm text-muted-foreground truncate">{user?.email}</div>
            {roleName && (
              <Badge variant="outline" className="mt-1 text-xs capitalize font-medium border-primary/30 text-primary">
                {roleName}
              </Badge>
            )}
          </div>
          <button onClick={() => openUserProfile()} className="flex-shrink-0 text-xs text-primary font-medium">
            Edit
          </button>
        </div>

        <SettingsSection
          title="Account"
          rows={[
            {
              icon: 'fas fa-user-circle',
              label: 'Profile',
              subtitle: 'Edit your name, photo, and email',
              action: () => openUserProfile(),
            },
            {
              icon: 'fas fa-lock',
              label: 'Password & security',
              subtitle: 'Manage your login and security settings',
              action: () => openUserProfile(),
            },
          ]}
        />

        <SettingsSection
          title="Notifications"
          rows={[
            {
              icon: 'fas fa-bell',
              label: 'Notifications & Alerts',
              subtitle: 'Configure which alerts you receive',
              action: () => toast({ title: 'Coming soon', description: 'Granular notification controls coming soon.' }),
            },
            {
              icon: 'fas fa-location-arrow',
              label: 'Location permissions',
              subtitle: 'Allow Smart Clock-In to detect your work location',
              action: () => toast({ title: 'Location', description: 'Manage location access in your device settings.' }),
            },
          ]}
        />

        <SettingsSection
          title="App"
          rows={[
            {
              icon: 'fas fa-calendar-check',
              label: 'Calendar Sync',
              subtitle: 'Sync your shifts to Apple or Google Calendar',
              badge: 'Disabled',
              action: () => toast({ title: 'Calendar Sync', description: 'Calendar sync coming soon.' }),
            },
            {
              icon: 'fas fa-map-marker-alt',
              label: 'Location settings',
              subtitle: 'PINs, geofencing and more',
              action: () => toast({ title: 'Locations', description: 'Location settings coming soon.' }),
            },
            {
              icon: 'fas fa-moon',
              label: 'Appearance',
              subtitle: 'Light, dark, or auto theme',
              action: () => toast({ title: 'Appearance', description: 'Theme settings coming soon.' }),
            },
          ]}
        />

        <SettingsSection
          title="Data & Privacy"
          rows={[
            {
              icon: 'fas fa-file-contract',
              label: 'Terms of Service',
              subtitle: 'View our terms and conditions',
              action: () => navigate('/terms'),
            },
            {
              icon: 'fas fa-bell-slash',
              label: 'Unsubscribe from notifications',
              subtitle: 'Stop all push notifications from Taime',
              action: () => setShowUnsubscribeDialog(true),
            },
            {
              icon: 'fas fa-trash-alt',
              label: 'Delete account',
              subtitle: 'Permanently delete your account and all data',
              action: () => { setDeleteConfirmText(''); setShowDeleteDialog(true); },
              danger: true,
            },
          ]}
        />

        <SettingsSection
          rows={[
            {
              icon: 'fas fa-sign-out-alt',
              label: 'Sign Out',
              action: handleSignOut,
              chevron: false,
              danger: true,
            },
          ]}
        />

        <p className="text-center text-xs text-muted-foreground mt-6 px-4">
          Taime AI Boutique Manager · v1.0
        </p>
      </div>

      {/* Unsubscribe dialog */}
      <AlertDialog open={showUnsubscribeDialog} onOpenChange={setShowUnsubscribeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsubscribe from notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all your registered devices and stop all push notifications from Taime.
              You can re-enable them at any time by opening the app on your device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unsubscribeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => unsubscribeMutation.mutate()}
              disabled={unsubscribeMutation.isPending}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {unsubscribeMutation.isPending ? 'Unsubscribing…' : 'Unsubscribe'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete account dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600 dark:text-red-400">
              Permanently delete your account?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This action is <strong>permanent and cannot be undone</strong>.
                  Your profile, time entries, messages, and all data will be deleted immediately.
                </p>
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <ul className="text-sm text-red-700 dark:text-red-300 space-y-1 list-disc list-inside">
                    <li>Your profile and login credentials</li>
                    <li>All time entries and schedule history</li>
                    <li>Your messages and kudos history</li>
                    <li>All gamification points and badges</li>
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">
                    Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm:
                  </p>
                  <Input
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE here"
                    className="border-red-300 focus-visible:ring-red-400"
                    autoCapitalize="characters"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccountMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteAccountMutation.mutate()}
              disabled={deleteConfirmText !== 'DELETE' || deleteAccountMutation.isPending}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-40"
            >
              {deleteAccountMutation.isPending ? 'Deleting…' : 'Permanently delete account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
