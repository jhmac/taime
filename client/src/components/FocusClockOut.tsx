import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { TimeEntry } from '@shared/schema';

const EXEMPT_ROLES = ['admin', 'owner'];

export default function FocusClockOut() {
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoClockedOutRef = useRef(false);
  const activeEntryRef = useRef<TimeEntry | null>(null);

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
        clockOutSource: 'auto-focus-loss',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/active'] });
    },
  });

  useEffect(() => {
    const userRole = user?.role?.name;
    if (!settings?.enableClockOutOnFocusLoss || (userRole && EXEMPT_ROLES.includes(userRole))) {
      return;
    }

    const graceSeconds = settings.focusLossGraceSeconds || 30;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (graceTimerRef.current) {
          clearTimeout(graceTimerRef.current);
        }

        graceTimerRef.current = setTimeout(() => {
          const currentEntry = activeEntryRef.current;
          if (document.hidden && currentEntry && !autoClockedOutRef.current) {
            autoClockedOutRef.current = true;
            clockOutMutation.mutate(currentEntry.id);
          }
        }, graceSeconds * 1000);
      } else {
        if (graceTimerRef.current) {
          clearTimeout(graceTimerRef.current);
          graceTimerRef.current = null;
        }

        if (autoClockedOutRef.current) {
          toast({
            title: "Auto Clocked Out",
            description: "You were automatically clocked out because the app lost focus.",
          });
          autoClockedOutRef.current = false;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
      }
    };
  }, [settings?.enableClockOutOnFocusLoss, settings?.focusLossGraceSeconds, clockOutMutation, toast, user?.role?.name]);

  return null;
}
