import { useEffect, useRef, useCallback } from 'react';
import { apiRequest } from '@/lib/queryClient';

const BREADCRUMB_INTERVAL_MS = 30000;

export function useOffsiteBreadcrumbReporter(sessionId: string | null | undefined) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null | undefined>(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const sendBreadcrumb = useCallback(async (sid: string) => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await apiRequest('POST', `/api/offsite-sessions/${sid}/breadcrumb`, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        } catch (err) {
          console.warn('[BreadcrumbReporter] Failed to send breadcrumb:', err);
        }
      },
      (err) => {
        console.warn('[BreadcrumbReporter] Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!sessionId) return;

    sendBreadcrumb(sessionId);

    intervalRef.current = setInterval(() => {
      const sid = sessionIdRef.current;
      if (sid) sendBreadcrumb(sid);
    }, BREADCRUMB_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sessionId, sendBreadcrumb]);
}
