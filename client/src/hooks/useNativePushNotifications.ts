import { useEffect } from 'react';
import { isNativePlatform, getPlatform } from '@/lib/capacitor';
import { useAuth } from '@/hooks/useAuth';

export function useNativePushNotifications() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isNativePlatform() || !isAuthenticated || !user) return;

    let mounted = true;
    const listeners: Array<{ remove: () => void }> = [];

    async function register() {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
      }
      if (permStatus.receive !== 'granted') return;

      await PushNotifications.register();

      const tokenListener = await PushNotifications.addListener('registration', async (token) => {
        if (!mounted) return;
        try {
          const resp = await fetch('/api/push/native-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              token: token.value,
              platform: getPlatform(),
            }),
          });
          const body = (await resp.json()) as { success: boolean; deliveryReady: boolean };
          if (body.deliveryReady) {
            console.log('[NativePush] Token registered — APNs/FCM delivery is active.');
          } else {
            console.log('[NativePush] Token registered — APNs/FCM server credentials not yet configured (follow-up #88). Web push still active.');
          }
        } catch (err) {
          console.warn('[NativePush] Failed to register token:', err);
        }
      });
      listeners.push(tokenListener);

      const errorListener = await PushNotifications.addListener('registrationError', (err) => {
        console.warn('[NativePush] Registration error:', err);
      });
      listeners.push(errorListener);

      const foregroundListener = await PushNotifications.addListener(
        'pushNotificationReceived',
        (notification) => {
          console.log('[NativePush] Foreground notification:', notification.title);
        }
      );
      listeners.push(foregroundListener);

      const actionListener = await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action) => {
          const data = action.notification.data as Record<string, string> | undefined;
          if (data?.url) {
            window.location.href = data.url;
          }
        }
      );
      listeners.push(actionListener);
    }

    register().catch((err) => {
      console.warn('[NativePush] Setup error:', err);
    });

    return () => {
      mounted = false;
      listeners.forEach((l) => l.remove());
    };
  }, [isAuthenticated, user?.id]);
}
