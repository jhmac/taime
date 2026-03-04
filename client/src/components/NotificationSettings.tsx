import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type NotificationPreferences = {
  clockReminders: boolean;
  taskAssignments: boolean;
  scheduleUpdates: boolean;
  overtimeWarnings: boolean;
  announcements: boolean;
  anomalyAlerts: boolean;
};

export default function NotificationSettings() {
  const { toast } = useToast();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');
  const [isSupported, setIsSupported] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const { data: vapidData } = useQuery<{ publicKey: string }>({
    queryKey: ['/api/push/vapid-key'],
  });
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    clockReminders: true,
    taskAssignments: true,
    scheduleUpdates: true,
    overtimeWarnings: true,
    announcements: true,
    anomalyAlerts: true,
  });

  const checkSubscriptionStatus = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setIsSupported(false);
        setIsLoading(false);
        return;
      }

      setPermissionStatus(Notification.permission);

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);

      const savedPrefs = localStorage.getItem('notificationPreferences');
      if (savedPrefs) {
        setPreferences(JSON.parse(savedPrefs));
      }
    } catch (error) {
      console.error('Error checking subscription status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSubscriptionStatus();
  }, [checkSubscriptionStatus]);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);

      if (permission !== 'granted') {
        throw new Error('Notification permission denied');
      }

      if (!vapidData?.publicKey) {
        throw new Error('VAPID public key not available');
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      });

      const p256dhKey = subscription.getKey('p256dh');
      const authKey = subscription.getKey('auth');

      if (!p256dhKey || !authKey) {
        throw new Error('Failed to get subscription keys');
      }

      const p256dh = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(p256dhKey))));
      const auth = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(authKey))));

      await apiRequest('POST', '/api/push/subscribe', {
        endpoint: subscription.endpoint,
        p256dh,
        auth,
      });

      return subscription;
    },
    onSuccess: () => {
      setIsSubscribed(true);
      toast({ title: 'Notifications Enabled', description: 'You will now receive push notifications.' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to Enable Notifications',
        description: error.message === 'Notification permission denied'
          ? 'Please allow notifications in your browser settings.'
          : error.message,
        variant: 'destructive',
      });
    },
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
    },
    onSuccess: () => {
      setIsSubscribed(false);
      toast({ title: 'Notifications Disabled', description: 'You will no longer receive push notifications.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to unsubscribe: ${error.message}`, variant: 'destructive' });
    },
  });

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/push/test');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Test Sent', description: 'A test notification has been sent to your device.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to send test: ${error.message}`, variant: 'destructive' });
    },
  });

  const handleToggle = async (enabled: boolean) => {
    if (enabled) {
      subscribeMutation.mutate();
    } else {
      unsubscribeMutation.mutate();
    }
  };

  const handlePreferenceChange = (key: keyof NotificationPreferences, value: boolean) => {
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);
    localStorage.setItem('notificationPreferences', JSON.stringify(updated));
  };

  const getPermissionBadge = () => {
    switch (permissionStatus) {
      case 'granted':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Granted</Badge>;
      case 'denied':
        return <Badge variant="destructive">Denied</Badge>;
      default:
        return <Badge variant="secondary">Not Set</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  if (!isSupported) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <i className="fas fa-bell text-primary"></i>
            Push Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <i className="fas fa-exclamation-triangle text-amber-500"></i>
            Push notifications are not supported in this browser.
          </div>
        </CardContent>
      </Card>
    );
  }

  const isBusy = subscribeMutation.isPending || unsubscribeMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <i className="fas fa-bell text-primary"></i>
              Push Notifications
            </CardTitle>
            {isSubscribed ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <i className="fas fa-check-circle mr-1"></i>Enabled
              </Badge>
            ) : (
              <Badge variant="secondary">
                <i className="fas fa-bell-slash mr-1"></i>Disabled
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Enable Push Notifications</p>
              <p className="text-xs text-muted-foreground">
                Receive alerts for clock reminders, tasks, and schedule changes
              </p>
            </div>
            <Switch
              checked={isSubscribed}
              onCheckedChange={handleToggle}
              disabled={isBusy || permissionStatus === 'denied'}
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Browser Permission:</span>
            {getPermissionBadge()}
          </div>

          {permissionStatus === 'denied' && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive">
                <i className="fas fa-exclamation-circle mr-1"></i>
                Notifications are blocked in your browser. Please update your browser settings to allow notifications for this site.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {isSubscribed && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <i className="fas fa-sliders-h text-primary"></i>
                Notification Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { key: 'clockReminders' as const, label: 'Clock Reminders', description: 'Clock in/out reminders based on location', icon: 'fa-clock' },
                { key: 'taskAssignments' as const, label: 'Task Assignments', description: 'New task and chore assignments', icon: 'fa-tasks' },
                { key: 'scheduleUpdates' as const, label: 'Schedule Updates', description: 'Shift changes and schedule modifications', icon: 'fa-calendar-alt' },
                { key: 'overtimeWarnings' as const, label: 'Overtime Warnings', description: 'Alerts when approaching overtime limits', icon: 'fa-exclamation-triangle' },
                { key: 'announcements' as const, label: 'Announcements', description: 'Team-wide announcements and updates', icon: 'fa-bullhorn' },
                { key: 'anomalyAlerts' as const, label: 'Anomaly Alerts', description: 'Unusual clock-in patterns and payroll issues', icon: 'fa-triangle-exclamation' },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <i className={`fas ${item.icon} text-xs text-muted-foreground`}></i>
                    </div>
                    <div>
                      <Label className="text-sm font-medium cursor-pointer">{item.label}</Label>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                  <Checkbox
                    checked={preferences[item.key]}
                    onCheckedChange={(checked) => handlePreferenceChange(item.key, !!checked)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Test Notification</p>
                  <p className="text-xs text-muted-foreground">Send a test push notification to this device</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testNotificationMutation.mutate()}
                  disabled={testNotificationMutation.isPending}
                >
                  {testNotificationMutation.isPending ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i>Sending...</>
                  ) : (
                    <><i className="fas fa-paper-plane mr-2"></i>Send Test</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
