import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import type { TimeEntry, Permission } from '@shared/schema';

const FOCUS_CLOCKOUT_PERMISSION = 'enable_clock_out_on_focus_loss';

export default function FocusClockOut() {
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const leftAtRef = useRef<Date | null>(null);
  const leftEntryIdRef = useRef<string | null>(null);
  const activeEntryRef = useRef<TimeEntry | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  const { data: activeTimeEntry } = useQuery<TimeEntry | null>({
    queryKey: ['/api/time-entries/active'],
    refetchInterval: 30000,
  });

  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ['/api/auth/permissions'],
    enabled: !!user,
  });

  const hasFocusClockOutPermission = userPermissions.some(
    (p) => p.name === FOCUS_CLOCKOUT_PERMISSION
  );

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

  useEffect(() => {
    if (!settings?.enableClockOutOnFocusLoss || !hasFocusClockOutPermission || !activeTimeEntry) {
      setShowResumePrompt(false);
      return;
    }

    const autoResumeWindowMs = (settings.autoResumeWindowSeconds || 600) * 1000;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        const currentEntry = activeEntryRef.current;
        if (currentEntry) {
          leftAtRef.current = new Date();
          leftEntryIdRef.current = currentEntry.id;
          logClockEvent('app-switch-out', currentEntry.id);
        }
      } else {
        if (leftAtRef.current && leftEntryIdRef.current) {
          const elapsedMs = Date.now() - leftAtRef.current.getTime();

          if (elapsedMs > autoResumeWindowMs) {
            setShowResumePrompt(true);
            logClockEvent('app-switch-return-late', leftEntryIdRef.current, {
              awaySeconds: Math.round(elapsedMs / 1000),
            });
            toast({
              title: "You Stepped Away",
              description: `You were away for ${Math.round(elapsedMs / 60000)} minute${Math.round(elapsedMs / 60000) !== 1 ? 's' : ''}. Would you like to clock out?`,
              variant: "destructive",
            });
          } else {
            leftAtRef.current = null;
            leftEntryIdRef.current = null;
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [settings?.enableClockOutOnFocusLoss, settings?.autoResumeWindowSeconds, hasFocusClockOutPermission, activeTimeEntry, toast, logClockEvent]);

  useEffect(() => {
    if (!activeTimeEntry) {
      setShowResumePrompt(false);
      leftAtRef.current = null;
      leftEntryIdRef.current = null;
    }
  }, [activeTimeEntry]);

  if (!showResumePrompt || !activeTimeEntry) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-[60] animate-in slide-in-from-top-5 duration-300">
      <div className="bg-white dark:bg-card border border-border rounded-xl p-4 shadow-xl flex items-start gap-3">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-bell"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-base text-foreground">You stepped away from the app</h3>
            <button 
              onClick={() => {
                setShowResumePrompt(false);
                leftAtRef.current = null;
                leftEntryIdRef.current = null;
              }}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            You stepped away from the app for a while. Would you like to clock out now?
          </p>
          <div className="flex gap-3">
            <Button
              variant="default"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg h-10 font-semibold"
              onClick={() => {
                const currentEntryId = leftEntryIdRef.current;
                if (currentEntryId) {
                  clockOutMutation.mutate(currentEntryId);
                }
                setShowResumePrompt(false);
                leftAtRef.current = null;
                leftEntryIdRef.current = null;
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
                leftAtRef.current = null;
                leftEntryIdRef.current = null;
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
