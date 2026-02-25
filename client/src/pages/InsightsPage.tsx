import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Lightbulb, AlertTriangle, Info, CheckCircle2,
  TrendingUp, Users, Calendar, RotateCcw, ShoppingBag,
  Eye, ThumbsUp, X, ChevronDown, ChevronUp, ShieldCheck, Loader2, RefreshCw,
} from "lucide-react";

interface Insight {
  id: string;
  storeId: string;
  insightType: string;
  severity: string;
  headline: string;
  detail: string;
  recommendation: string;
  dataPayload: Record<string, unknown> | null;
  status: string;
  acknowledgedBy: string | null;
  actedOnAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; border: string; label: string }> = {
  action_needed: {
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    label: "Action Needed",
  },
  warning: {
    icon: Info,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    label: "Warning",
  },
  suggestion: {
    icon: Lightbulb,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    label: "Suggestion",
  },
  info: {
    icon: CheckCircle2,
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-950/30",
    border: "border-slate-200 dark:border-slate-800",
    label: "Info",
  },
};

const TYPE_CONFIG: Record<string, { icon: typeof Users; label: string; link?: string }> = {
  staffing: { icon: Users, label: "Staffing", link: "/schedules" },
  task_anomaly: { icon: CheckCircle2, label: "Tasks", link: "/tasks" },
  predictive_schedule: { icon: Calendar, label: "Scheduling", link: "/schedules" },
  recurring_issue: { icon: RotateCcw, label: "Issues", link: "/issues" },
  sales_trend: { icon: ShoppingBag, label: "Sales", link: "/analytics" },
  sop_friction: { icon: TrendingUp, label: "SOP Friction", link: "/sops" },
};

export default function InsightsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  if (typeFilter !== "all") queryParams.set("insight_type", typeFilter);
  if (severityFilter !== "all") queryParams.set("severity", severityFilter);
  queryParams.set("limit", "50");

  const { data, isLoading } = useQuery<{ success: boolean; data: Insight[] }>({
    queryKey: ["/api/background-insights", typeFilter, severityFilter],
    queryFn: async () => {
      const res = await fetch(`/api/background-insights?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: summaryData } = useQuery<{ success: boolean; data: { totalActive: number; actionNeededCount: number; byType: Record<string, number> } }>({
    queryKey: ["/api/background-insights/summary"],
    queryFn: async () => {
      const res = await fetch("/api/background-insights/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PUT", `/api/background-insights/${id}`, { status });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/background-insights"] });
      qc.invalidateQueries({ queryKey: ["/api/background-insights/summary"] });
      toast({ title: "Insight updated" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/background-insights/generate", {});
    },
    onSuccess: () => {
      toast({ title: "Analysis started", description: "New insights will appear shortly." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/background-insights"] });
        qc.invalidateQueries({ queryKey: ["/api/background-insights/summary"] });
      }, 5000);
    },
  });

  const insights = data?.data || [];
  const summary = summaryData?.data;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-card border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="font-semibold text-base">AI Insights</h1>
              <p className="text-xs text-muted-foreground">
                {summary ? `${summary.totalActive} active` : "Loading..."}
                {summary && summary.actionNeededCount > 0 && (
                  <span className="text-red-500 ml-1">({summary.actionNeededCount} need action)</span>
                )}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Analyze
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="flex-1 h-9 text-xs">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="staffing">Staffing</SelectItem>
              <SelectItem value="task_anomaly">Task Anomalies</SelectItem>
              <SelectItem value="predictive_schedule">Scheduling</SelectItem>
              <SelectItem value="recurring_issue">Recurring Issues</SelectItem>
              <SelectItem value="sales_trend">Sales Trends</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="flex-1 h-9 text-xs">
              <SelectValue placeholder="All severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="action_needed">Action Needed</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="suggestion">Suggestion</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
          </div>
        )}

        {!isLoading && insights.length === 0 && (
          <Card className="border-green-200 dark:border-green-800">
            <CardContent className="p-6 text-center">
              <ShieldCheck className="h-10 w-10 mx-auto text-green-500 mb-2" />
              <p className="font-medium text-green-700 dark:text-green-400">All Clear</p>
              <p className="text-xs text-muted-foreground mt-1">No active insights to review</p>
            </CardContent>
          </Card>
        )}

        {insights.map(insight => {
          const sev = SEVERITY_CONFIG[insight.severity] || SEVERITY_CONFIG.info;
          const typeInfo = TYPE_CONFIG[insight.insightType] || { icon: Lightbulb, label: insight.insightType };
          const SevIcon = sev.icon;
          const TypeIcon = typeInfo.icon;
          const isExpanded = expandedId === insight.id;
          const isActionNeeded = insight.severity === "action_needed";

          return (
            <Card
              key={insight.id}
              className={`border transition-all ${sev.border} ${isActionNeeded ? "animate-pulse-subtle" : ""}`}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <div className={`p-1.5 rounded ${sev.bg} flex-shrink-0 mt-0.5`}>
                      <SevIcon className={`h-3.5 w-3.5 ${sev.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-0.5">
                          <TypeIcon className="h-2.5 w-2.5" />
                          {typeInfo.label}
                        </Badge>
                        <Badge className={`text-[10px] h-5 px-1.5 ${sev.bg} ${sev.color} border-0`}>
                          {sev.label}
                        </Badge>
                      </div>
                      <p className="font-medium text-sm mt-1">{insight.headline}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={() => setExpandedId(isExpanded ? null : insight.id)}
                  >
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="space-y-3 pt-1">
                    <p className="text-sm text-muted-foreground">{insight.detail}</p>
                    <div className={`p-3 rounded-lg ${sev.bg} border ${sev.border}`}>
                      <p className="text-xs font-medium mb-0.5">Recommendation</p>
                      <p className="text-sm">{insight.recommendation}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(insight.createdAt).toLocaleDateString()} at {new Date(insight.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {insight.expiresAt && ` · Expires ${new Date(insight.expiresAt).toLocaleDateString()}`}
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 gap-1 flex-1"
                    onClick={() => updateMutation.mutate({ id: insight.id, status: "acknowledged" })}
                    disabled={updateMutation.isPending}
                  >
                    <Eye className="h-3 w-3" />
                    Acknowledge
                  </Button>
                  {(typeInfo as any).link && (
                    <Button
                      variant="default"
                      size="sm"
                      className="text-xs h-8 gap-1 flex-1"
                      onClick={() => navigate((typeInfo as any).link)}
                    >
                      <ThumbsUp className="h-3 w-3" />
                      Take Action
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8 gap-1"
                    onClick={() => updateMutation.mutate({ id: insight.id, status: "dismissed" })}
                    disabled={updateMutation.isPending}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
