import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import type { TimeEntry } from '@shared/schema';

const EXEMPT_ROLES = ['admin', 'owner'];

export default function FocusClockOut() {
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockReleasedByScreenLockRef = useRef(false);
  const clockedOutAtRef = useRef<Date | null>(null);
  const clockedOutEntryRef = useRef<string | null>(null);
  const activeEntryRef = useRef<TimeEntry | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  const { data: activeTimeEntry } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: 30000,
  });

  useEffect(() => {
    activeEntryRef.current = activeTimeEntry ?? null;
  }, [activeTimeEntry]);

  const clockOutMutation = useMutation({
    mutationFn: async (timeEntryId: string) => {
      return await apiRequest('PATCH', `/api/time-entries/${timeEntryId}`, {
        clockOutTime: new Date(),
        clockOutSource: 'app-switch-out',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
    },
  });

  const autoResumeMutation = useMutation({
    mutationFn: async (data: { originalEntryId: string; clockOutTime: Date }) => {
      await apiRequest('PATCH', `/api/time-entries/${data.originalEntryId}`, {
        clockOutTime: null,
        clockOutSource: null,
      });
      return { resumed: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
      toast({
        title: "Welcome Back",
        description: "Your shift has been resumed automatically.",
      });
    },
  });

  const promptResumeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/time-entries', {
        clockInTime: new Date(),
        clockInSource: 'prompted-resume',
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
      logClockEvent('prompted-resume', data?.id);
      setShowResumePrompt(false);
      clockedOutAtRef.current = null;
      clockedOutEntryRef.current = null;
      toast({
        title: "Clocked Back In",
        description: "You've been clocked back in. Stay focused!",
      });
    },
  });

  const logClockEvent = useCallback(async (eventType: string, timeEntryId?: string, metadata?: any) => {
    try {
      await apiRequest('POST', '/api/clock-events', {
        eventType,
        timeEntryId: timeEntryId || null,
        metadata: metadata || null,
      });
    } catch (e) {
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockReleasedByScreenLockRef.current = false;

      wakeLockRef.current.addEventListener('release', () => {
        wakeLockReleasedByScreenLockRef.current = true;
        wakeLockRef.current = null;
      });
    } catch (e) {
    }
  }, []);

  useEffect(() => {
    const userRole = user?.role?.name;
    if (!settings?.enableClockOutOnFocusLoss || (userRole && EXEMPT_ROLES.includes(userRole))) {
      return;
    }

    requestWakeLock();

    const autoResumeWindowMs = (settings.autoResumeWindowSeconds || 120) * 1000;

    const handleVisibilityChange = async () => {
      if (document.hidden) {
        const wasScreenLock = wakeLockReleasedByScreenLockRef.current;

        if (wasScreenLock) {
          return;
        }

        const currentEntry = activeEntryRef.current;
        if (currentEntry) {
          clockedOutAtRef.current = new Date();
          clockedOutEntryRef.current = currentEntry.id;
          clockOutMutation.mutate(currentEntry.id);
          logClockEvent('app-switch-out', currentEntry.id);
        }
      } else {
        await requestWakeLock();

        if (clockedOutAtRef.current && clockedOutEntryRef.current) {
          const elapsedMs = Date.now() - clockedOutAtRef.current.getTime();

          if (elapsedMs <= autoResumeWindowMs) {
            autoResumeMutation.mutate({
              originalEntryId: clockedOutEntryRef.current,
              clockOutTime: clockedOutAtRef.current,
            });
            logClockEvent('auto-resume', clockedOutEntryRef.current, {
              awaySeconds: Math.round(elapsedMs / 1000),
            });
            clockedOutAtRef.current = null;
            clockedOutEntryRef.current = null;
          } else {
            setShowResumePrompt(true);
            logClockEvent('app-switch-return-late', clockedOutEntryRef.current, {
              awaySeconds: Math.round(elapsedMs / 1000),
            });
            toast({
              title: "You Were Clocked Out",
              description: `You were away for ${Math.round(elapsedMs / 60000)} minutes. Tap "Clock Back In" to resume your shift.`,
              variant: "destructive",
            });
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, [settings?.enableClockOutOnFocusLoss, settings?.autoResumeWindowSeconds, clockOutMutation, autoResumeMutation, toast, user?.role?.name, requestWakeLock, logClockEvent]);

  if (!showResumePrompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 bg-destructive text-destructive-foreground rounded-lg p-4 shadow-lg animate-in slide-in-from-bottom-5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="font-semibold text-sm">You were clocked out</p>
          <p className="text-xs opacity-90">You left the app. Tap to clock back in.</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setShowResumePrompt(false);
              clockedOutAtRef.current = null;
              clockedOutEntryRef.current = null;
            }}
          >
            Dismiss
          </Button>
          <Button
            size="sm"
            variant="default"
            className="bg-white text-destructive hover:bg-white/90"
            onClick={() => promptResumeMutation.mutate()}
            disabled={promptResumeMutation.isPending}
          >
            {promptResumeMutation.isPending ? 'Clocking In...' : 'Clock Back In'}
          </Button>
        </div>
      </div>
    </div>
  );
}
