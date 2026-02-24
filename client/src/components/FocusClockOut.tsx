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
    if (!settings?.enableClockOutOnFocusLoss || (userRole && EXEMPT_ROLES.includes(userRole)) || !activeTimeEntry) {
      setShowResumePrompt(false);
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
    <div className="fixed top-4 left-4 right-4 z-[60] animate-in slide- shore-from-top-5 duration-300">
      <div className="bg-white dark:bg-card border border-border rounded-xl p-4 shadow-xl flex items-start gap-3">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-bell"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-base text-foreground">Don't forget to clock out!</h3>
            <button 
              onClick={() => {
                setShowResumePrompt(false);
                clockedOutAtRef.current = null;
                clockedOutEntryRef.current = null;
              }}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            We noticed you left the work location. Tap here to clock out now.
          </p>
          <div className="flex gap-3">
            <Button
              variant="default"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg h-10 font-semibold"
              onClick={() => {
                const currentEntryId = clockedOutEntryRef.current;
                if (currentEntryId) {
                  clockOutMutation.mutate(currentEntryId);
                }
                setShowResumePrompt(false);
              }}
              disabled={clockOutMutation.isPending}
            >
              Clock Out Now
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-border text-foreground rounded-lg h-10 font-semibold"
              onClick={() => {
                setShowResumePrompt(false);
                clockedOutAtRef.current = null;
                clockedOutEntryRef.current = null;
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
