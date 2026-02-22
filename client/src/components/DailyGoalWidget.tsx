import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';

interface DailyGoalData {
  hasGoal: boolean;
  message?: string;
  dayName?: string;
  goal?: {
    revenue: number;
    orders: number;
    basedOnDate: string;
    sampleSize: number;
  };
  current?: {
    revenue: number;
    orders: number;
  };
  progress?: number;
}

export default function DailyGoalWidget() {
  const { data, isLoading } = useQuery<DailyGoalData>({
    queryKey: ['/api/dashboard/daily-goal'],
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-muted rounded w-1/3"></div>
            <div className="h-20 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data?.hasGoal) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Daily Goal
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-5">
          <div className="text-center py-4 text-muted-foreground">
            <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{data?.message || 'Connect Shopify to set daily goals'}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { goal, current, progress = 0, dayName } = data;
  const progressClamped = Math.min(progress, 100);
  const revenueGoal = goal?.revenue || 0;
  const currentRevenue = current?.revenue || 0;
  const currentOrders = current?.orders || 0;
  const goalOrders = goal?.orders || 0;

  const getProgressColor = () => {
    if (progressClamped >= 80) return 'from-green-500 to-emerald-500';
    if (progressClamped >= 50) return 'from-blue-500 to-cyan-500';
    if (progressClamped >= 25) return 'from-amber-500 to-yellow-500';
    return 'from-red-500 to-orange-500';
  };

  const getProgressBg = () => {
    if (progressClamped >= 80) return 'bg-green-100 dark:bg-green-900/20';
    if (progressClamped >= 50) return 'bg-blue-100 dark:bg-blue-900/20';
    if (progressClamped >= 25) return 'bg-amber-100 dark:bg-amber-900/20';
    return 'bg-red-100 dark:bg-red-900/20';
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          {dayName}'s Goal
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">
            Based on {goal?.sampleSize} {dayName}s last year
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-5 space-y-4">
        <div className="relative">
          <div className={`w-full h-3 rounded-full ${getProgressBg()} overflow-hidden`}>
            <div
              className={`h-full rounded-full bg-gradient-to-r ${getProgressColor()} transition-all duration-1000 ease-out`}
              style={{ width: `${progressClamped}%` }}
            />
          </div>
          <div className="flex justify-between items-baseline mt-2">
            <div>
              <span className="text-2xl font-bold">${currentRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
              <span className="text-sm text-muted-foreground ml-1">/ ${revenueGoal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
            <span className={`text-lg font-bold ${progressClamped >= 80 ? 'text-green-600 dark:text-green-400' : progressClamped >= 50 ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
              {progressClamped}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/40">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <ShoppingBag className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">{currentOrders} / {goalOrders}</p>
              <p className="text-[10px] text-muted-foreground">Orders</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/40">
            <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">${revenueGoal > 0 ? Math.round(revenueGoal - currentRevenue).toLocaleString() : 0}</p>
              <p className="text-[10px] text-muted-foreground">Remaining</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
