import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';

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

type CredentialsStatus = {
  vapidReady: boolean;
  apnsReady: boolean;
  fcmReady: boolean;
};

type TestChannels = {
  web: { attempted: number; succeeded: number; failed: number; credentialsReady: boolean };
  ios: { tokensRegistered: number; credentialsReady: boolean; succeeded: number; failed: number };
  android: { tokensRegistered: number; credentialsReady: boolean; succeeded: number; failed: number };
};

type TestResult = {
  success: boolean;
  message: string;
  channels?: TestChannels;
  nativeStatus?: string;
};

type TestNotificationError = Error & { data?: TestResult };

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken: () => Promise<string | null>;
      };
    };
  }
}

function CredentialBadge({ ready }: { ready: boolean }) {
  if (ready) {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 shrink-0">
        <i className="fas fa-check-circle mr-1"></i>Configured
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="shrink-0">
      <i className="fas fa-times-circle mr-1"></i>Not configured
    </Badge>
  );
}

function SetupInstructions({ channel }: { channel: 'apns' | 'fcm' | 'vapid' }) {
  if (channel === 'apns') {
    return (
      <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-400">Set these secrets to enable iOS push:</p>
        <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-300 font-mono">
          <li>APNS_KEY_ID — your APNs Auth Key ID (10-char string)</li>
          <li>APNS_TEAM_ID — your Apple Team ID (10-char string)</li>
          <li>APNS_KEY_P8 — the contents of your .p8 key file</li>
          <li>APNS_BUNDLE_ID — your app bundle ID (optional)</li>
        </ul>
        <p className="text-amber-600 dark:text-amber-400 pt-1">Generate an APNs Auth Key in Apple Developer → Certificates, IDs &amp; Profiles → Keys.</p>
      </div>
    );
  }
  if (channel === 'fcm') {
    return (
      <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-400">Set one of these secrets to enable Android push:</p>
        <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-300 font-mono">
          <li>FCM_SERVICE_ACCOUNT_JSON — recommended: service account JSON from Firebase Console</li>
          <li>FCM_SERVER_KEY — legacy: server key from Firebase Console → Cloud Messaging</li>
        </ul>
        <p className="text-amber-600 dark:text-amber-400 pt-1">For the recommended option, download the service account JSON from Firebase Console → Project Settings → Service Accounts → Generate new private key.</p>
      </div>
    );
  }
  return (
    <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs space-y-1">
      <p className="font-medium text-amber-800 dark:text-amber-400">Set these secrets to enable web push:</p>
      <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-300 font-mono">
        <li>VAPID_PUBLIC_KEY</li>
        <li>VAPID_PRIVATE_KEY</li>
      </ul>
      <p className="text-amber-600 dark:text-amber-400 pt-1">Generate a VAPID key pair using <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">npx web-push generate-vapid-keys</code>.</p>
    </div>
  );
}

export default function NotificationSettings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');
  const [isSupported, setIsSupported] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [lastTestResult, setLastTestResult] = useState<TestResult | null>(null);

  const [showApnsForm, setShowApnsForm] = useState(false);
  const [apnsForm, setApnsForm] = useState({ keyId: '', teamId: '', keyP8: '', bundleId: '' });

  const [showFcmForm, setShowFcmForm] = useState(false);
  const [fcmForm, setFcmForm] = useState({ serviceAccountJson: '' });

  const { data: vapidData } = useQuery<{ publicKey: string }>({
    queryKey: ['/api/push/vapid-key'],
  });

  const { data: credentialsStatus } = useQuery<CredentialsStatus>({
    queryKey: ['/api/push/credentials-status'],
  });

  const saveApnsMutation = useMutation({
    mutationFn: (data: typeof apnsForm) =>
      apiRequest('PATCH', '/api/push/credentials/apns', data),
    onSuccess: () => {
      toast({ title: 'APNs credentials saved', description: 'iOS push delivery is now configured.' });
      setShowApnsForm(false);
      setApnsForm({ keyId: '', teamId: '', keyP8: '', bundleId: '' });
      queryClient.invalidateQueries({ queryKey: ['/api/push/credentials-status'] });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to save APNs credentials', description: err.message, variant: 'destructive' });
    },
  });

  const saveFcmMutation = useMutation({
    mutationFn: (data: typeof fcmForm) =>
      apiRequest('PATCH', '/api/push/credentials/fcm', data),
    onSuccess: () => {
      toast({ title: 'FCM credentials saved', description: 'Android push delivery is now configured.' });
      setShowFcmForm(false);
      setFcmForm({ serviceAccountJson: '' });
      queryClient.invalidateQueries({ queryKey: ['/api/push/credentials-status'] });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to save FCM credentials', description: err.message, variant: 'destructive' });
    },
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
    mutationFn: async (): Promise<TestResult> => {
      let authHeaders: Record<string, string> = {};
      try {
        const token = await window.Clerk?.session?.getToken();
        if (token) authHeaders = { Authorization: `Bearer ${token}` };
      } catch {}

      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        credentials: 'include',
      });

      let data: TestResult;
      try {
        data = await res.json();
      } catch {
        throw new Error(res.ok ? 'Unexpected response' : `${res.status}: ${res.statusText}`);
      }

      if (!res.ok) {
        const err: TestNotificationError = new Error(data.message || `Error ${res.status}`);
        err.data = data;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      setLastTestResult(data);
      toast({ title: 'Test Sent', description: data.message });
    },
    onError: (error: TestNotificationError) => {
      if (error.data) setLastTestResult(error.data);
      toast({ title: 'Test Failed', description: error.message, variant: 'destructive' });
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <i className="fas fa-satellite-dish text-primary"></i>
            Push Delivery Channels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Configure server-side credentials to enable push delivery to each platform.
            {isAdmin ? ' Enter credentials directly below to update them without developer access.' : ' These are set as environment secrets by your developer.'}
          </p>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="fas fa-globe text-blue-500"></i>
                  <span className="text-sm font-medium">Web Push (VAPID)</span>
                </div>
                <CredentialBadge ready={credentialsStatus?.vapidReady ?? false} />
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                Delivers notifications to browsers on desktop and mobile web.
              </p>
              {credentialsStatus && !credentialsStatus.vapidReady && (
                <div className="ml-6">
                  <SetupInstructions channel="vapid" />
                </div>
              )}
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="fab fa-apple text-gray-700 dark:text-gray-300"></i>
                  <span className="text-sm font-medium">iOS (APNs)</span>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowApnsForm(v => !v)}
                    >
                      <i className={`fas fa-${showApnsForm ? 'times' : 'pencil-alt'} mr-1`}></i>
                      {credentialsStatus?.apnsReady ? 'Update' : 'Configure'}
                    </Button>
                  )}
                  <CredentialBadge ready={credentialsStatus?.apnsReady ?? false} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                Delivers native push notifications to iPhones and iPads via Apple Push Notification service.
              </p>
              {showApnsForm && isAdmin && (
                <div className="ml-6 mt-3 space-y-3 p-4 rounded-lg border bg-muted/30">
                  <p className="text-xs font-medium text-foreground">Enter APNs credentials — values are write-only and will not be displayed after saving.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Key ID <span className="text-destructive">*</span></Label>
                      <Input
                        className="h-8 text-xs font-mono"
                        placeholder="XXXXXXXXXX"
                        value={apnsForm.keyId}
                        onChange={e => setApnsForm(f => ({ ...f, keyId: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Team ID <span className="text-destructive">*</span></Label>
                      <Input
                        className="h-8 text-xs font-mono"
                        placeholder="XXXXXXXXXX"
                        value={apnsForm.teamId}
                        onChange={e => setApnsForm(f => ({ ...f, teamId: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Bundle ID <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      placeholder="com.yourcompany.app"
                      value={apnsForm.bundleId}
                      onChange={e => setApnsForm(f => ({ ...f, bundleId: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Key P8 contents <span className="text-destructive">*</span></Label>
                    <Textarea
                      className="text-xs font-mono h-24 resize-none"
                      placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                      value={apnsForm.keyP8}
                      onChange={e => setApnsForm(f => ({ ...f, keyP8: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      disabled={saveApnsMutation.isPending || !apnsForm.keyId || !apnsForm.teamId || !apnsForm.keyP8}
                      onClick={() => saveApnsMutation.mutate(apnsForm)}
                    >
                      {saveApnsMutation.isPending ? (
                        <><i className="fas fa-spinner fa-spin mr-1"></i>Saving…</>
                      ) : (
                        <><i className="fas fa-save mr-1"></i>Save APNs Credentials</>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => { setShowApnsForm(false); setApnsForm({ keyId: '', teamId: '', keyP8: '', bundleId: '' }); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {!showApnsForm && credentialsStatus && !credentialsStatus.apnsReady && !isAdmin && (
                <div className="ml-6">
                  <SetupInstructions channel="apns" />
                </div>
              )}
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <i className="fab fa-android text-green-600"></i>
                  <span className="text-sm font-medium">Android (FCM)</span>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowFcmForm(v => !v)}
                    >
                      <i className={`fas fa-${showFcmForm ? 'times' : 'pencil-alt'} mr-1`}></i>
                      {credentialsStatus?.fcmReady ? 'Update' : 'Configure'}
                    </Button>
                  )}
                  <CredentialBadge ready={credentialsStatus?.fcmReady ?? false} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                Delivers native push notifications to Android devices via Firebase Cloud Messaging.
              </p>
              {showFcmForm && isAdmin && (
                <div className="ml-6 mt-3 space-y-3 p-4 rounded-lg border bg-muted/30">
                  <p className="text-xs font-medium text-foreground">Enter the FCM service account JSON — the value is write-only and will not be displayed after saving.</p>
                  <div className="space-y-1">
                    <Label className="text-xs">Service Account JSON <span className="text-destructive">*</span></Label>
                    <Textarea
                      className="text-xs font-mono h-32 resize-none"
                      placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
                      value={fcmForm.serviceAccountJson}
                      onChange={e => setFcmForm({ serviceAccountJson: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Download from Firebase Console → Project Settings → Service Accounts → Generate new private key.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      disabled={saveFcmMutation.isPending || !fcmForm.serviceAccountJson}
                      onClick={() => saveFcmMutation.mutate(fcmForm)}
                    >
                      {saveFcmMutation.isPending ? (
                        <><i className="fas fa-spinner fa-spin mr-1"></i>Saving…</>
                      ) : (
                        <><i className="fas fa-save mr-1"></i>Save FCM Credentials</>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => { setShowFcmForm(false); setFcmForm({ serviceAccountJson: '' }); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {!showFcmForm && credentialsStatus && !credentialsStatus.fcmReady && !isAdmin && (
                <div className="ml-6">
                  <SetupInstructions channel="fcm" />
                </div>
              )}
            </div>
          </div>
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
        </>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <i className="fas fa-paper-plane text-primary"></i>
            Send Test Notification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Test Push Delivery</p>
              <p className="text-xs text-muted-foreground">
                Send a test notification and see results per channel
              </p>
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

          {lastTestResult && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last Test Results</p>
              <div className="space-y-2">
                {lastTestResult.channels && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <i className="fas fa-globe text-blue-500 w-4 text-center"></i>
                        <span>Web Push</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {lastTestResult.channels.web.attempted === 0 ? (
                          <Badge variant="secondary" className="text-xs">No subscription</Badge>
                        ) : lastTestResult.channels.web.succeeded > 0 ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                            <i className="fas fa-check mr-1"></i>
                            {lastTestResult.channels.web.succeeded}/{lastTestResult.channels.web.attempted} sent
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            Failed ({lastTestResult.channels.web.failed})
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <i className="fab fa-apple text-gray-700 dark:text-gray-300 w-4 text-center"></i>
                        <span>iOS</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!lastTestResult.channels.ios.credentialsReady ? (
                          <Badge variant="destructive" className="text-xs">Credentials missing</Badge>
                        ) : lastTestResult.channels.ios.tokensRegistered === 0 ? (
                          <Badge variant="secondary" className="text-xs">No device registered</Badge>
                        ) : lastTestResult.channels.ios.succeeded > 0 ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                            <i className="fas fa-check mr-1"></i>
                            {lastTestResult.channels.ios.succeeded}/{lastTestResult.channels.ios.tokensRegistered} sent
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            Failed ({lastTestResult.channels.ios.failed})
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <i className="fab fa-android text-green-600 w-4 text-center"></i>
                        <span>Android</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!lastTestResult.channels.android.credentialsReady ? (
                          <Badge variant="destructive" className="text-xs">Credentials missing</Badge>
                        ) : lastTestResult.channels.android.tokensRegistered === 0 ? (
                          <Badge variant="secondary" className="text-xs">No device registered</Badge>
                        ) : lastTestResult.channels.android.succeeded > 0 ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                            <i className="fas fa-check mr-1"></i>
                            {lastTestResult.channels.android.succeeded}/{lastTestResult.channels.android.tokensRegistered} sent
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            Failed ({lastTestResult.channels.android.failed})
                          </Badge>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
