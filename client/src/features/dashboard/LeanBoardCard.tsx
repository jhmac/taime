import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart3, TrendingUp, TrendingDown, Minus, Lightbulb,
  Heart, ShieldCheck, ArrowRight,
} from "lucide-react";

interface LeanMetrics {
  improvements_submitted: number;
  videos_uploaded: number;
  kudos_given: number;
  sop_completion_rate: number;
  issues_resolved: number;
  issues_opened: number;
  team_participation_rate: number;
}

interface TrendWeek {
  improvements: number;
  videos: number;
  kudos: number;
  sopRate: number;
}

function Trend({ current, previous }: { current: number; previous: number }) {
  if (current > previous) return <TrendingUp className="h-3 w-3 text-emerald-500" />;
  if (current < previous) return <TrendingDown className="h-3 w-3 text-amber-500" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

export default function LeanBoardCard() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<{
    currentMetrics: LeanMetrics | null;
    trends: TrendWeek[];
  }>({
    queryKey: ["/api/lean-board", "week"],
    queryFn: async () => {
      const res = await fetch("/api/lean-board?period=week", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data?.currentMetrics) return null;

  const m = data.currentMetrics;
  const prev = data.trends?.length >= 2 ? data.trends[data.trends.length - 2] : null;

  const topMetrics = [
    {
      icon: Lightbulb,
      label: "Improvements",
      value: m.improvements_submitted,
      prev: prev?.improvements || 0,
      color: "text-amber-600 dark:text-amber-400",
    },
    {
      icon: Heart,
      label: "Kudos",
      value: m.kudos_given,
      prev: prev?.kudos || 0,
      color: "text-pink-600 dark:text-pink-400",
    },
    {
      icon: ShieldCheck,
      label: "SOP Rate",
      value: `${m.sop_completion_rate}%`,
      prev: prev?.sopRate || 0,
      numVal: m.sop_completion_rate,
      color: "text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <Card className="border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/20">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            <h3 className="text-sm font-bold">Team Lean Board</h3>
          </div>
          <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => navigate("/lean-board")}>
            View <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {topMetrics.map((metric, i) => {
            const Icon = metric.icon;
            const numValue = typeof metric.value === "number" ? metric.value : metric.numVal || 0;
            return (
              <div key={i} className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Icon className={`h-3 w-3 ${metric.color}`} />
                  <Trend current={numValue} previous={metric.prev} />
                </div>
                <p className="text-lg font-bold">{metric.value}</p>
                <p className="text-[10px] text-muted-foreground">{metric.label}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
