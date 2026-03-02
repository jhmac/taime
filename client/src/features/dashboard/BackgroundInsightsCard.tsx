import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Lightbulb, AlertTriangle, Info, CheckCircle2, ChevronRight, Eye, ShieldCheck,
  Clock, DollarSign, Shield,
} from "lucide-react";

interface Insight {
  id: string;
  insightType: string;
  severity: string;
  headline: string;
  detail: string;
  recommendation: string;
  status: string;
  createdAt: string;
}

type TabType = "all" | "anomalies" | "insights";

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; label: string }> = {
  action_needed: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800",
    label: "Action",
  },
  warning: {
    icon: Info,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800",
    label: "Warning",
  },
  suggestion: {
    icon: Lightbulb,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800",
    label: "Tip",
  },
  info: {
    icon: CheckCircle2,
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-100 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800",
    label: "Info",
  },
};

const ANOMALY_TYPES = ["clock_in_anomaly", "payroll_anomaly"];

function getAnomalyIcon(insightType: string) {
  if (insightType === "clock_in_anomaly") return Clock;
  if (insightType === "payroll_anomaly") return DollarSign;
  return Shield;
}

export default function BackgroundInsightsCard() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabType>("all");

  const { data, isLoading } = useQuery<{ success: boolean; data: Insight[] }>({
    queryKey: ["/api/background-insights"],
    queryFn: async () => {
      const res = await fetch("/api/background-insights?limit=10", { credentials: "include" });
      if (!res.ok) return { success: true, data: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PUT", `/api/background-insights/${id}`, { status: "acknowledged" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/background-insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/background-insights/summary"] });
    },
  });

  const allInsights = data?.data || [];
  const anomalies = allInsights.filter(i => ANOMALY_TYPES.includes(i.insightType));
  const regularInsights = allInsights.filter(i => !ANOMALY_TYPES.includes(i.insightType));
  const actionCount = anomalies.filter(i => i.severity === "action_needed").length;
  const warningCount = anomalies.filter(i => i.severity === "warning").length;

  const displayed = activeTab === "anomalies" ? anomalies
    : activeTab === "insights" ? regularInsights
    : allInsights;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">AI Insights</span>
          </div>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (allInsights.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">AI Insights</span>
          </div>
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <ShieldCheck className="h-4 w-4" />
            <span className="text-xs">No issues detected</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">AI Insights</span>
          </div>
          <div className="flex gap-1">
            {actionCount > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 px-1.5">{actionCount} alert{actionCount !== 1 ? 's' : ''}</Badge>
            )}
            {warningCount > 0 && (
              <Badge className="text-[10px] h-5 px-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-0">
                {warningCount} warning{warningCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>

        {(anomalies.length > 0 || regularInsights.length > 0) && (
          <div className="flex gap-1">
            {(["all", "anomalies", "insights"] as TabType[]).map(tab => {
              const count = tab === "anomalies" ? anomalies.length : tab === "insights" ? regularInsights.length : allInsights.length;
              if (count === 0 && tab !== "all") return null;
              return (
                <Button
                  key={tab}
                  variant={activeTab === tab ? "default" : "ghost"}
                  size="sm"
                  className="text-[10px] h-6 px-2"
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === "all" ? "All" : tab === "anomalies" ? "Anomalies" : "Insights"}
                  {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
                </Button>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          {displayed.slice(0, 5).map(insight => {
            const sev = SEVERITY_CONFIG[insight.severity] || SEVERITY_CONFIG.info;
            const isAnomaly = ANOMALY_TYPES.includes(insight.insightType);
            const SevIcon = isAnomaly ? getAnomalyIcon(insight.insightType) : sev.icon;
            const isAction = insight.severity === "action_needed";

            return (
              <div
                key={insight.id}
                className={`flex items-start gap-2 p-2 rounded-lg border ${sev.bg} ${isAction ? "animate-pulse-subtle" : ""}`}
              >
                <SevIcon className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${sev.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-medium leading-tight">{insight.headline}</p>
                    {isAnomaly && (
                      <Badge variant="outline" className="text-[8px] h-4 px-1 flex-shrink-0">
                        {insight.insightType === "clock_in_anomaly" ? "Clock" : "Payroll"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{insight.recommendation}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => acknowledgeMutation.mutate(insight.id)}
                  disabled={acknowledgeMutation.isPending}
                  title="Acknowledge"
                >
                  <Eye className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>

        {allInsights.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs gap-1 h-8"
            onClick={() => navigate("/insights")}
          >
            View all {allInsights.length} insights
            <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
