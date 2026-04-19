import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ErrorWithRetry from "@/components/ErrorWithRetry";
import { useOnlineRetry } from "@/hooks/useOnlineRetry";
import {
  ShieldCheck, AlertTriangle, Info, CheckCircle2, ChevronRight, Eye,
} from "lucide-react";

interface Insight {
  id: string;
  insightType: string;
  severity: string;
  sopTemplateId: string | null;
  headline: string;
  detail: string;
  recommendation: string;
  dataPoint: string | null;
  status: string;
  createdAt: string;
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; label: string }> = {
  action_needed: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800",
    label: "Action Needed",
  },
  warning: {
    icon: Info,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800",
    label: "Warning",
  },
  info: {
    icon: CheckCircle2,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800",
    label: "Info",
  },
};

export default function SOPInsightsCard() {
  const [, navigate] = useLocation();

  const { data: insights, isLoading, isError, refetch } = useQuery<Insight[]>({
    queryKey: ["/api/sops/insights"],
    staleTime: 5 * 60 * 1000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PUT", `/api/sops/insights/${id}/acknowledge`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sops/insights"] });
    },
  });

  useOnlineRetry(refetch, isError);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-4">
          <ErrorWithRetry onRetry={() => refetch()} message="Could not load SOP insights" />
        </CardContent>
      </Card>
    );
  }

  const activeInsights = insights || [];
  const actionNeeded = activeInsights.filter(i => i.severity === "action_needed").length;
  const warnings = activeInsights.filter(i => i.severity === "warning").length;

  if (activeInsights.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="font-medium">SOP Health</span>
            <Badge variant="secondary" className="ml-auto text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              All Clear
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            No SOP issues detected. Procedures are running smoothly.
          </p>
        </CardContent>
      </Card>
    );
  }

  const displayInsights = activeInsights.slice(0, 4);

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="font-medium">SOP Insights</span>
          </div>
          <div className="flex items-center gap-1.5">
            {actionNeeded > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {actionNeeded} action{actionNeeded > 1 ? "s" : ""}
              </Badge>
            )}
            {warnings > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100">
                {warnings} warning{warnings > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {displayInsights.map((insight) => {
            const config = SEVERITY_CONFIG[insight.severity] || SEVERITY_CONFIG.info;
            const Icon = config.icon;

            return (
              <div key={insight.id} className={`rounded-lg border p-2.5 ${config.bg}`}>
                <div className="flex items-start gap-2">
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-tight">{insight.headline}</p>
                    {insight.dataPoint && (
                      <span className={`text-[10px] font-semibold ${config.color}`}>{insight.dataPoint}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => acknowledgeMutation.mutate(insight.id)}
                    disabled={acknowledgeMutation.isPending}
                    title="Acknowledge"
                  >
                    <Eye className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {activeInsights.length > 4 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs gap-1"
            onClick={() => navigate("/sops")}
          >
            View all {activeInsights.length} insights <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
