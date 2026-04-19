import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, DollarSign, ShoppingBag } from 'lucide-react';
import ErrorWithRetry from '@/components/ErrorWithRetry';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useEffect } from 'react';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import type { Permission } from '@shared/schema';

interface PulseData {
  headline: string;
  detail: string;
  suggestion?: string;
  revenue: number;
  transactionCount: number;
  averageOrderValue: number;
  targetRevenue?: number;
  lastWeekRevenue?: number;
  paceToTarget?: number;
  staleData: boolean;
  generatedAt: string;
}

export default function MiddayPulseCard() {
  const { lastMessage } = useWebSocket();
  const { toast } = useToast();
  const { user } = useAuth();

  const roleName = user?.role?.name ?? '';
  const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';

  const { data: permissions = [] } = useQuery<Permission[]>({
    queryKey: ['/api/auth/permissions'],
    enabled: !!user && !isAdminOrOwner,
    staleTime: 5 * 60 * 1000,
  });

  const hasSalesView = isAdminOrOwner || permissions.some(p => p.name === 'sales.view' || p.name === 'admin.manage_all');

  useEffect(() => {
    if (lastMessage?.type === 'midday_pulse') {
      queryClient.invalidateQueries({ queryKey: ['/api/rituals/pulse/today'] });
      const pulse = lastMessage.data as PulseData;
      if (pulse?.headline) {
        toast({
          title: "Midday Pulse",
          description: pulse.headline,
        });
      }
    }
  }, [lastMessage, toast]);

  const now = new Date();
  const isAfterNoon = now.getHours() >= 12;

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ success: boolean; data: PulseData | null }>({
    queryKey: ['/api/rituals/pulse/today'],
    staleTime: 5 * 60 * 1000,
    enabled: isAfterNoon,
  });

  if (!isAfterNoon || !hasSalesView) return null;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5">
          <Skeleton className="h-5 w-3/4 mb-3" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return <ErrorWithRetry onRetry={() => refetch()} message="Failed to load midday pulse" isRetrying={isFetching} />;
  }

  if (!data?.data) return null;
  const pulse = data.data;

  const paceColor = pulse.paceToTarget
    ? pulse.paceToTarget >= 100 ? 'text-green-600 dark:text-green-400' : pulse.paceToTarget >= 80 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'
    : '';

  const PaceIcon = pulse.paceToTarget && pulse.paceToTarget >= 100 ? TrendingUp : TrendingDown;

  return (
    <Card className="overflow-hidden border-l-4 border-l-blue-500">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            Midday Pulse
          </CardTitle>
          {pulse.staleData && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1">
              <AlertTriangle className="h-3 w-3" />
              Data may be delayed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-semibold text-base">{pulse.headline}</p>
        <p className="text-sm text-muted-foreground">{pulse.detail}</p>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/50 rounded-lg p-2.5 text-center">
            <DollarSign className="h-4 w-4 mx-auto mb-1 text-green-600" />
            <p className="text-sm font-bold">${pulse.revenue.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">Revenue</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2.5 text-center">
            <ShoppingBag className="h-4 w-4 mx-auto mb-1 text-blue-600" />
            <p className="text-sm font-bold">{pulse.transactionCount}</p>
            <p className="text-[10px] text-muted-foreground">Transactions</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-2.5 text-center">
            <DollarSign className="h-4 w-4 mx-auto mb-1 text-purple-600" />
            <p className="text-sm font-bold">${pulse.averageOrderValue.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">Avg Order</p>
          </div>
        </div>

        {pulse.paceToTarget && (
          <div className={`flex items-center gap-2 text-sm ${paceColor}`}>
            <PaceIcon className="h-4 w-4" />
            <span className="font-medium">{pulse.paceToTarget}% pace vs last week</span>
          </div>
        )}

        {pulse.lastWeekRevenue !== undefined && pulse.lastWeekRevenue > 0 && (
          <p className="text-xs text-muted-foreground">
            Same day last week: ${pulse.lastWeekRevenue.toFixed(0)}
          </p>
        )}

        {pulse.suggestion && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-sm text-blue-800 dark:text-blue-200">{pulse.suggestion}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
