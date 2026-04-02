import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox, CalendarCheck, AlertTriangle, Zap, ArrowRight } from "lucide-react";

interface GTDDashboardData {
  inbox_count: number;
  actions_today_count: number;
  actions_overdue_count: number;
  waiting_overdue_count: number;
  projects_active_count: number;
  two_minute_actions_count: number;
}

export default function GTDDashboardWidget() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<{ success: boolean; data: GTDDashboardData }>({
    queryKey: ["/api/gtd/dashboard"],
    staleTime: 60_000,
  });

  const stats = data?.data;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-9 w-full mt-4" />
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const overdueTotal = (stats.actions_overdue_count || 0) + (stats.waiting_overdue_count || 0);

  const metrics = [
    {
      label: "Inbox",
      value: stats.inbox_count,
      icon: Inbox,
      bg: "bg-blue-500 dark:bg-blue-600",
      onClick: () => navigate("/gtd/inbox"),
    },
    {
      label: "Due Today",
      value: stats.actions_today_count,
      icon: CalendarCheck,
      bg: "bg-emerald-500 dark:bg-emerald-600",
      onClick: () => navigate("/gtd/actions"),
    },
    {
      label: "Overdue",
      value: overdueTotal,
      icon: AlertTriangle,
      bg: overdueTotal > 0 ? "bg-red-500 dark:bg-red-600" : "bg-slate-400 dark:bg-slate-600",
      onClick: () => navigate("/gtd/actions"),
    },
    {
      label: "Quick Wins",
      value: stats.two_minute_actions_count,
      icon: Zap,
      bg: stats.two_minute_actions_count > 0 ? "bg-amber-500 dark:bg-amber-600" : "bg-slate-400 dark:bg-slate-600",
      onClick: () => navigate("/gtd/actions"),
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Getting Things Done</h3>

        <div className="grid grid-cols-2 gap-2">
          {metrics.map(m => (
            <button
              key={m.label}
              onClick={m.onClick}
              className={`${m.bg} rounded-2xl p-4 text-left transition-transform active:scale-95 hover:brightness-110 cursor-pointer`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <m.icon className="h-4 w-4 text-white" />
                </div>
              </div>
              <span className="text-2xl font-bold text-white block">{m.value}</span>
              <span className="text-xs text-white/80 font-medium">{m.label}</span>
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full mt-3"
          onClick={() => navigate("/gtd/actions")}
        >
          What should I do next?
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}
