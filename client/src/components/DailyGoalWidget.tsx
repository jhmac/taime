import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, ShoppingBag, DollarSign, TrendingUp, ArrowRight } from 'lucide-react';

interface DailyGoalData {
  hasGoal: boolean;
  goalEnabled: boolean;
  message?: string;
  dayName?: string;
  lastYearRevenue?: number;
  lastYearOrders?: number;
  lastYearDate?: string;
  increaseType?: string;
  increaseValue?: number;
  increaseAmount?: number;
  averageOrderValue?: number;
  goal?: {
    revenue: number;
    orders: number;
  };
  current?: {
    revenue: number;
    orders: number;
  };
  amountRemaining?: number;
  salesNeeded?: number;
  progress?: number;
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

  if (!data?.goalEnabled) {
    return null;
  }

  if (!data?.hasGoal) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Daily Sales Goal
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-5">
          <div className="text-center py-4 text-muted-foreground">
            <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{data?.message || 'No sales data available for comparison'}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const {
    goal,
    current,
    progress = 0,
    dayName,
    lastYearRevenue = 0,
    increaseType,
    increaseValue = 0,
    increaseAmount = 0,
    averageOrderValue = 0,
    amountRemaining = 0,
    salesNeeded = 0,
  } = data;

  const progressClamped = Math.min(progress, 100);
  const goalRevenue = goal?.revenue || 0;
  const currentRevenue = current?.revenue || 0;
  const currentOrders = current?.orders || 0;
  const goalOrders = goal?.orders || 0;
  const isGoalMet = goalRevenue > 0 && currentRevenue >= goalRevenue;

  const getProgressColor = () => {
    if (isGoalMet) return 'from-green-500 to-emerald-500';
    if (progressClamped >= 75) return 'from-blue-500 to-cyan-500';
    if (progressClamped >= 40) return 'from-amber-500 to-yellow-500';
    return 'from-orange-500 to-red-500';
  };

  const getProgressBg = () => {
    if (isGoalMet) return 'bg-green-100 dark:bg-green-900/20';
    if (progressClamped >= 75) return 'bg-blue-100 dark:bg-blue-900/20';
    if (progressClamped >= 40) return 'bg-amber-100 dark:bg-amber-900/20';
    return 'bg-orange-100 dark:bg-orange-900/20';
  };

  const increaseLabel = increaseValue > 0
    ? increaseType === 'percentage'
      ? `+${increaseValue}%`
      : `+$${fmt(increaseValue)}`
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          {dayName}'s Sales Goal
          {increaseLabel && (
            <span className="text-[10px] font-normal text-primary bg-primary/10 px-1.5 py-0.5 rounded ml-1">
              {increaseLabel} vs last year
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-5 space-y-4">

        {/* Goal breakdown: last year → increase → goal */}
        {increaseValue > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
            <span className="font-medium">${fmt(lastYearRevenue)}</span>
            <span>last {dayName}</span>
            <ArrowRight className="h-3 w-3 flex-shrink-0" />
            <span className="text-primary font-medium">+${fmt(increaseAmount)}</span>
            <ArrowRight className="h-3 w-3 flex-shrink-0" />
            <span className="font-semibold text-foreground">${fmt(goalRevenue)} goal</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="relative">
          <div className={`w-full h-3 rounded-full ${getProgressBg()} overflow-hidden`}>
            <div
              className={`h-full rounded-full bg-gradient-to-r ${getProgressColor()} transition-all duration-1000 ease-out`}
              style={{ width: `${progressClamped}%` }}
            />
          </div>
          <div className="flex justify-between items-baseline mt-2">
            <div>
              <span className="text-2xl font-bold">${fmt(currentRevenue)}</span>
              <span className="text-sm text-muted-foreground ml-1">/ ${fmt(goalRevenue)}</span>
            </div>
            <span className={`text-lg font-bold ${isGoalMet ? 'text-green-600 dark:text-green-400' : progressClamped >= 75 ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
              {progressClamped}%
            </span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/40">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <ShoppingBag className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{currentOrders} / {goalOrders}</p>
              <p className="text-[10px] text-muted-foreground">Orders today</p>
            </div>
          </div>

          {isGoalMet ? (
            <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-green-50 dark:bg-green-900/20">
              <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-green-700 dark:text-green-400">Goal met!</p>
                <p className="text-[10px] text-muted-foreground">+${fmt(currentRevenue - goalRevenue)}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/40">
              <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                <DollarSign className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">${fmt(amountRemaining)}</p>
                <p className="text-[10px] text-muted-foreground">Remaining</p>
              </div>
            </div>
          )}
        </div>

        {/* Sales needed callout — only when not yet at goal */}
        {!isGoalMet && salesNeeded > 0 && averageOrderValue > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed rounded-lg px-3 py-2">
            <TrendingUp className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span>
              <span className="font-semibold text-foreground">{salesNeeded} more {salesNeeded === 1 ? 'sale' : 'sales'}</span>
              {' '}needed · avg ${fmt(averageOrderValue)} per order
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
