import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, TrendingDown, Minus, Lightbulb, Video,
  Heart, ShieldCheck, AlertTriangle, CheckCircle2,
  Users, Flame, BarChart3, Sparkles,
} from "lucide-react";

interface LeanMetrics {
  improvements_submitted: number;
  videos_uploaded: number;
  kudos_given: number;
  sop_completion_rate: number;
  issues_resolved: number;
  issues_opened: number;
  avg_sop_completion_time_trend: "improving" | "stable" | "declining";
  active_improvement_streaks: number;
  team_participation_rate: number;
}

interface TrendWeek {
  weekStart: string;
  improvements: number;
  videos: number;
  kudos: number;
  sopRate: number;
}

interface LeanPattern {
  type: string;
  title: string;
  description: string;
  trend: "positive" | "neutral" | "negative";
}

interface LeanBoardData {
  currentMetrics: LeanMetrics | null;
  trends: TrendWeek[];
  patterns: LeanPattern[];
  weeklySummary: string | null;
  snapshotCount: number;
}

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
] as const;

function TrendArrow({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <Minus className="h-4 w-4 text-muted-foreground" />;
  if (current > previous) return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  if (current < previous) return <TrendingDown className="h-4 w-4 text-amber-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function MiniBarChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-0.5 h-10">
      {data.map((val, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-sm ${color}`}
          style={{
            height: `${Math.max((val / max) * 100, 4)}%`,
            opacity: i === data.length - 1 ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

function MetricCard({
  icon: Icon, label, value, suffix, trend, color, bgColor, chartData, chartColor,
}: {
  icon: any; label: string; value: number | string; suffix?: string;
  trend: { current: number; previous: number };
  color: string; bgColor: string;
  chartData?: number[]; chartColor?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-9 h-9 rounded-lg ${bgColor} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`h-4 w-4 ${color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-bold">{value}{suffix}</span>
              <TrendArrow current={trend.current} previous={trend.previous} />
            </div>
          </div>
        </div>
        {chartData && chartData.length > 0 && (
          <MiniBarChart data={chartData} color={chartColor || "bg-primary"} />
        )}
      </CardContent>
    </Card>
  );
}

export default function LeanBoard() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("week");
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<LeanBoardData>({
    queryKey: ["/api/lean-board", period],
    queryFn: async () => {
      const res = await fetch(`/api/lean-board?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  const metrics = data?.currentMetrics;
  const trends = data?.trends || [];
  const patterns = data?.patterns || [];

  const prevWeekIdx = trends.length >= 2 ? trends.length - 2 : 0;
  const prevWeek = trends[prevWeekIdx] || { improvements: 0, videos: 0, kudos: 0, sopRate: 0 };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 md:py-10 space-y-6">

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted-foreground">Collective improvement culture health</p>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {PERIODS.map(p => (
              <Button
                key={p.value}
                variant={period === p.value ? "default" : "ghost"}
                size="sm"
                className="text-xs h-7"
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {data?.weeklySummary && (
          <Card className="bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 border-violet-200 dark:border-violet-800">
            <CardContent className="p-4">
              <div className="flex items-start gap-2.5">
                <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-400 mb-1">
                    Weekly Summary
                  </h3>
                  <p className="text-sm leading-relaxed">{data.weeklySummary}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!metrics && (
          <Card>
            <CardContent className="p-8 text-center">
              <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-semibold mb-1">No Data Yet</h3>
              <p className="text-sm text-muted-foreground">
                Snapshots are taken nightly at 11 PM. Check back tomorrow for your first Lean Board data!
              </p>
            </CardContent>
          </Card>
        )}

        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricCard
              icon={Lightbulb}
              label="Improvements"
              value={metrics.improvements_submitted}
              trend={{ current: metrics.improvements_submitted, previous: prevWeek.improvements }}
              color="text-amber-600 dark:text-amber-400"
              bgColor="bg-amber-100 dark:bg-amber-900/30"
              chartData={trends.map(t => t.improvements)}
              chartColor="bg-amber-400"
            />
            <MetricCard
              icon={Video}
              label="Videos Shared"
              value={metrics.videos_uploaded}
              trend={{ current: metrics.videos_uploaded, previous: prevWeek.videos }}
              color="text-blue-600 dark:text-blue-400"
              bgColor="bg-blue-100 dark:bg-blue-900/30"
              chartData={trends.map(t => t.videos)}
              chartColor="bg-blue-400"
            />
            <MetricCard
              icon={Heart}
              label="Kudos Given"
              value={metrics.kudos_given}
              trend={{ current: metrics.kudos_given, previous: prevWeek.kudos }}
              color="text-pink-600 dark:text-pink-400"
              bgColor="bg-pink-100 dark:bg-pink-900/30"
              chartData={trends.map(t => t.kudos)}
              chartColor="bg-pink-400"
            />
            <MetricCard
              icon={ShieldCheck}
              label="SOP Completion"
              value={metrics.sop_completion_rate}
              suffix="%"
              trend={{ current: metrics.sop_completion_rate, previous: prevWeek.sopRate }}
              color="text-emerald-600 dark:text-emerald-400"
              bgColor="bg-emerald-100 dark:bg-emerald-900/30"
              chartData={trends.map(t => t.sopRate)}
              chartColor="bg-emerald-400"
            />
            <MetricCard
              icon={AlertTriangle}
              label="Issues Opened / Resolved"
              value={`${metrics.issues_opened} / ${metrics.issues_resolved}`}
              trend={{ current: metrics.issues_resolved, previous: metrics.issues_opened }}
              color="text-orange-600 dark:text-orange-400"
              bgColor="bg-orange-100 dark:bg-orange-900/30"
            />
            <MetricCard
              icon={Users}
              label="Team Participation"
              value={metrics.team_participation_rate}
              suffix="%"
              trend={{ current: metrics.team_participation_rate, previous: 0 }}
              color="text-violet-600 dark:text-violet-400"
              bgColor="bg-violet-100 dark:bg-violet-900/30"
            />
          </div>
        )}

        {metrics && metrics.active_improvement_streaks > 0 && (
          <Card className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 border-orange-200 dark:border-orange-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
                  <Flame className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">{metrics.active_improvement_streaks} Active Streak{metrics.active_improvement_streaks !== 1 ? "s" : ""}</h3>
                  <p className="text-xs text-muted-foreground">
                    {metrics.active_improvement_streaks} team member{metrics.active_improvement_streaks !== 1 ? "s" : ""} submitted improvements 3+ days this week
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {patterns.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              Patterns Detected
            </h2>
            {patterns.map((p, i) => (
              <Card key={i} className={`overflow-hidden ${
                p.trend === "positive"
                  ? "border-l-4 border-l-emerald-500"
                  : p.trend === "negative"
                    ? "border-l-4 border-l-amber-400"
                    : "border-l-4 border-l-blue-400"
              }`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-2.5">
                    <div className={`mt-0.5 ${
                      p.trend === "positive" ? "text-emerald-500" : p.trend === "negative" ? "text-amber-500" : "text-blue-500"
                    }`}>
                      {p.trend === "positive" ? <CheckCircle2 className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold mb-0.5">{p.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        )}

        <Card className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 border-blue-200 dark:border-blue-800">
          <CardContent className="p-5 text-center">
            <h3 className="text-sm font-bold mb-2">Got a quick improvement?</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Every "What Bugged You?" or improvement video grows the team's culture of continuous improvement.
            </p>
            <div className="flex justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => navigate("/improvements")}
              >
                <Video className="h-3.5 w-3.5" /> Share a Video
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
