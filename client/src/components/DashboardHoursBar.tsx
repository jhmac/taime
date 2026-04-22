import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';

interface HoursSummary {
  todayHours: number;
  weekHours: number;
  periodHours: number;
  hourlyRate: number | null;
  approximatePay: number | null;
}

function fmt(hours: number) {
  return hours.toFixed(1);
}

export default function DashboardHoursBar() {
  const { data, isLoading } = useQuery<HoursSummary>({
    queryKey: ['/api/time-entries/my-summary'],
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 animate-pulse">
        <div className="h-4 bg-muted rounded w-64"></div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap px-4 py-2.5 text-sm">
      <Calendar className="h-4 w-4 text-primary shrink-0" />
      <span className="font-bold text-foreground ml-0.5">Today</span>
      <span className="font-semibold text-primary">{fmt(data.todayHours)} hrs</span>
      <span className="text-muted-foreground mx-1">|</span>
      <span className="text-muted-foreground">This week</span>
      <span className="font-semibold text-foreground">{fmt(data.weekHours)} hrs</span>
      <span className="text-muted-foreground mx-2">This Period</span>
      <span className="font-semibold text-foreground">{fmt(data.periodHours)}</span>
      {data.approximatePay != null && (
        <>
          <span className="text-muted-foreground mx-2">Approximate Pay</span>
          <span className="font-semibold text-foreground">
            ${data.approximatePay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </>
      )}
    </div>
  );
}
