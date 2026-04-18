import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { WifiOff, RefreshCw } from 'lucide-react';
import AssociateDashboard from './AssociateDashboard';
import ManagerDashboard from './ManagerDashboard';
import OwnerDashboard from './OwnerDashboard';

interface DashboardInitData {
  user: any;
  activeTimeEntry: any | null;
  permissions: any[];
  companySettings: any | null;
  gamificationScore: { overallScore: number; tier: string } | null;
  gamificationError?: boolean;
  todaySummary: {
    totalClockedIn: number;
    totalScheduled: number;
    activeEntries: any[];
  } | null;
  todaySummaryError?: boolean;
}

export interface DashboardPartialErrors {
  gamificationError: boolean;
  todaySummaryError: boolean;
}

// Maximum time to wait for /api/dashboard/init before rendering anyway.
// If the endpoint is slow or fails, we still show the dashboard so
// individual widget queries can run normally (no indefinite skeleton).
const INIT_TIMEOUT_MS = 3000;

export default function DashboardRouter() {
  const { user, isLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: initData, isError: initError, refetch: refetchInit, isFetching: initFetching } = useQuery<DashboardInitData>({
    queryKey: ['/api/dashboard/init'],
    enabled: !!user,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Deadline-based fallback: if init hasn't resolved within INIT_TIMEOUT_MS,
  // render the dashboard anyway so per-widget queries can run normally.
  const [initTimedOut, setInitTimedOut] = useState(false);
  useEffect(() => {
    if (!user || initData || initError) return;
    const id = setTimeout(() => setInitTimedOut(true), INIT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [user, initData, initError]);

  // Pre-populate the query cache from the consolidated init response.
  // Child dashboards get cache hits on first render instead of separate requests.
  useEffect(() => {
    if (!initData) return;

    if (initData.activeTimeEntry !== undefined) {
      queryClient.setQueryData(['/api/time-entries/active'], initData.activeTimeEntry);
    }

    if (Array.isArray(initData.permissions)) {
      queryClient.setQueryData(['/api/auth/permissions'], initData.permissions);
    }

    if (initData.companySettings) {
      queryClient.setQueryData(['/api/company-settings'], initData.companySettings);
    }

    if (initData.gamificationScore) {
      queryClient.setQueryData(['/api/gamification/my-score'], initData.gamificationScore);
    }

    if (initData.todaySummary) {
      queryClient.setQueryData(['/api/dashboard/today-summary'], initData.todaySummary);
    }

    // Store partial-failure flags so child dashboards can show a subtle warning
    // without making an extra network request.
    queryClient.setQueryData<DashboardPartialErrors>(['/api/dashboard/partial-errors'], {
      gamificationError: !!initData.gamificationError,
      todaySummaryError: !!initData.todaySummaryError,
    });
  }, [initData, queryClient]);

  // Wait for auth, then wait for init (unless it errored or timed out).
  // On error, show a retry prompt so the user isn't left with a silent spinner.
  // On timeout (slow connection), fall through so per-widget queries can run.
  const initSettled = !!initData || initError || initTimedOut;
  if (isLoading || (user && !initSettled)) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
        <WifiOff className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="font-medium">Couldn't load the dashboard</p>
          <p className="text-sm text-muted-foreground mt-1">
            Check your connection and try again.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => { setInitTimedOut(false); refetchInit(); }}
          disabled={initFetching}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${initFetching ? 'animate-spin' : ''}`} />
          Retry
        </Button>
      </div>
    );
  }

  const role = user?.role?.name;

  if (role === 'owner') {
    return <OwnerDashboard />;
  }

  if (role === 'admin') {
    return <ManagerDashboard />;
  }

  return <AssociateDashboard />;
}
