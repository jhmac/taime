import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, AlertTriangle, TrendingUp, ChevronRight, Lightbulb } from "lucide-react";

interface OperationalInsight {
  id: string;
  insightType: string;
  affectedArea: string;
  severity: "info" | "suggestion" | "warning" | "action_needed";
  observation: string;
  whyItMatters?: string | null;
  recommendedAction: string;
  status: string;
  createdAt: string;
}

interface SummaryResponse {
  success: boolean;
  data: {
    totalActive: number;
    actionNeededCount: number;
    byType: Record<string, number>;
    byArea: Record<string, number>;
  };
}

interface ListResponse {
  success: boolean;
  data: OperationalInsight[];
}

function severityVisuals(sev: string) {
  switch (sev) {
    case "action_needed":
      return { color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-900/50", label: "Action needed", icon: AlertTriangle };
    case "warning":
      return { color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-900/50", label: "Warning", icon: AlertTriangle };
    case "suggestion":
      return { color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-900/50", label: "Suggestion", icon: Lightbulb };
    default:
      return { color: "text-slate-700 dark:text-slate-300", bg: "bg-slate-50 dark:bg-slate-900/30", border: "border-slate-200 dark:border-slate-800", label: "Info", icon: TrendingUp };
  }
}

export default function OperationalInsightsCard() {
  const [, navigate] = useLocation();

  const { data: summary, isLoading: summaryLoading } = useQuery<SummaryResponse>({
    queryKey: ["/api/insights/operational/summary"],
  });

  const { data: list, isLoading: listLoading } = useQuery<ListResponse>({
    queryKey: ["/api/insights/operational", { limit: 3 }],
    queryFn: async () => {
      const res = await fetch("/api/insights/operational?limit=3", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load insights");
      return res.json();
    },
  });

  const isLoading = summaryLoading || listLoading;
  const totalActive = summary?.data?.totalActive || 0;
  const actionNeeded = summary?.data?.actionNeededCount || 0;
  const insights = list?.data || [];

  return (
    <Card data-testid="operational-insights-card" className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shrink-0">
              <Brain className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">AI Insights</CardTitle>
              <p className="text-[11px] text-muted-foreground">Operations intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {actionNeeded > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {actionNeeded} urgent
              </Badge>
            )}
            {totalActive > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {totalActive} active
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="animate-pulse h-16 bg-muted rounded-lg" />
            ))}
          </div>
        ) : insights.length === 0 ? (
          <div className="text-center py-6 px-2">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/40 mx-auto flex items-center justify-center mb-2">
              <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-medium">Operations look healthy</p>
            <p className="text-xs text-muted-foreground mt-1">MAinager will surface insights as patterns appear.</p>
          </div>
        ) : (
          insights.slice(0, 3).map(insight => {
            const v = severityVisuals(insight.severity);
            const Icon = v.icon;
            return (
              <button
                key={insight.id}
                type="button"
                onClick={() => navigate("/insights/operational")}
                className={`w-full text-left rounded-lg border p-2.5 ${v.bg} ${v.border} hover:opacity-90 transition-opacity`}
                data-testid={`op-insight-${insight.id}`}
              >
                <div className="flex items-start gap-2">
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${v.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[10px] font-semibold uppercase tracking-wide ${v.color}`}>{v.label}</span>
                      <span className="text-[10px] text-muted-foreground">{insight.affectedArea}</span>
                    </div>
                    <p className="text-xs font-medium leading-snug line-clamp-2">{insight.observation}</p>
                    {insight.whyItMatters && (
                      <p className="text-[11px] text-muted-foreground italic leading-snug line-clamp-2 mt-0.5">
                        Why it matters: {insight.whyItMatters}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between mt-1"
          onClick={() => navigate("/insights/operational")}
          data-testid="op-insights-view-all"
        >
          <span>View all insights</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
