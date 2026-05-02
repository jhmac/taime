import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Brain, AlertTriangle, Lightbulb, TrendingUp, RefreshCw, X, CheckCircle2, ArrowLeft,
  Calendar, ListChecks, MessageSquareWarning, Loader2, Users,
} from "lucide-react";

interface OperationalInsight {
  id: string;
  insightType: string;
  affectedArea: string;
  severity: "info" | "suggestion" | "warning" | "action_needed";
  observation: string;
  whyItMatters?: string | null;
  recommendedAction: string;
  status: string;
  dataPayload?: Record<string, unknown> | null;
  createdAt: string;
}

interface ListResponse { success: boolean; data: OperationalInsight[]; }

function sevConfig(sev: string) {
  switch (sev) {
    case "action_needed":
      return { label: "Action needed", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", border: "border-l-red-500", badge: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300" };
    case "warning":
      return { label: "Warning", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-l-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" };
    case "suggestion":
      return { label: "Suggestion", color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-l-blue-500", badge: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300" };
    default:
      return { label: "Info", color: "text-slate-700 dark:text-slate-300", bg: "bg-slate-50 dark:bg-slate-900/30", border: "border-l-slate-400", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
  }
}

function areaIcon(area: string) {
  switch (area) {
    case "scheduling": return Calendar;
    case "tasks": return ListChecks;
    case "issues": return MessageSquareWarning;
    case "team": return Users;
    default: return TrendingUp;
  }
}

export default function OperationalInsights() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  type StatusTab = "active" | "acted_on" | "dismissed";
  const STATUS_TABS: readonly StatusTab[] = ["active", "acted_on", "dismissed"] as const;
  const [statusTab, setStatusTab] = useState<StatusTab>("active");
  const [dismissTarget, setDismissTarget] = useState<OperationalInsight | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [actTarget, setActTarget] = useState<OperationalInsight | null>(null);
  const [actTaskTitle, setActTaskTitle] = useState("");
  const [actTaskDescription, setActTaskDescription] = useState("");

  const listKey: readonly [string, { status: StatusTab }] = [
    "/api/insights/operational",
    { status: statusTab },
  ];
  const { data, isLoading, refetch, isFetching } = useQuery<ListResponse>({
    queryKey: listKey,
    queryFn: async () => {
      const res = await fetch(`/api/insights/operational?status=${statusTab}&limit=50`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load insights");
      return res.json();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/insights/operational/${id}/dismiss`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights/operational"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights/operational/summary"] });
      toast({ title: "Insight dismissed", description: "MAinager will learn from this and avoid similar suggestions." });
      setDismissTarget(null);
      setDismissReason("");
    },
    onError: () => toast({ title: "Could not dismiss", description: "Please try again.", variant: "destructive" }),
  });

  const actMutation = useMutation({
    mutationFn: async ({ id, taskTitle, taskDescription }: { id: string; taskTitle?: string; taskDescription?: string }) => {
      const res = await apiRequest("POST", `/api/insights/operational/${id}/act-on`, {
        taskTitle: taskTitle || undefined,
        taskDescription: taskDescription || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights/operational"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights/operational/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task created", description: "An action task was added to your list." });
      setActTarget(null);
      setActTaskTitle("");
      setActTaskDescription("");
    },
    onError: () => toast({ title: "Could not create task", description: "Please try again.", variant: "destructive" }),
  });

  const regenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/insights/operational/regenerate", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Regeneration started", description: "Refreshed insights will appear shortly." });
      setTimeout(() => refetch(), 8000);
    },
  });

  const insights = data?.data || [];

  const openActDialog = (insight: OperationalInsight) => {
    setActTarget(insight);
    setActTaskTitle(`[AI Insight] ${insight.observation.slice(0, 60)}`);
    setActTaskDescription(`AI Recommendation:\n${insight.recommendedAction}\n\nOriginal observation:\n${insight.observation}`);
  };

  return (
    <div className="min-h-screen bg-background pb-12" data-testid="operational-insights-page">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="op-insights-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                <Brain className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-tight">Operational AI Insights</h1>
                <p className="text-xs text-muted-foreground">Patterns MAinager noticed in your operations</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => regenMutation.mutate()}
              disabled={regenMutation.isPending}
              data-testid="op-insights-regenerate"
            >
              {regenMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <RefreshCw className="h-4 w-4 mr-2" />}
              Regenerate
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Tabs
          value={statusTab}
          onValueChange={(v) => {
            if ((STATUS_TABS as readonly string[]).includes(v)) {
              setStatusTab(v as StatusTab);
            }
          }}
        >
          <TabsList>
            <TabsTrigger value="active" data-testid="tab-active">Active</TabsTrigger>
            <TabsTrigger value="acted_on" data-testid="tab-acted-on">Acted on</TabsTrigger>
            <TabsTrigger value="dismissed" data-testid="tab-dismissed">Dismissed</TabsTrigger>
          </TabsList>
        </Tabs>

        {(isLoading || isFetching) && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-32 animate-pulse bg-muted rounded-xl" />)}
          </div>
        )}

        {!isLoading && !isFetching && insights.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mb-3">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-base font-semibold">No insights here yet</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                {statusTab === "active"
                  ? "Operations look healthy right now. New patterns will surface here automatically."
                  : statusTab === "acted_on"
                    ? "Insights you act on will move here so you can track what changed."
                    : "Insights you dismiss will move here so MAinager can learn what isn't useful."}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isFetching && insights.map(insight => {
          const cfg = sevConfig(insight.severity);
          const AreaIcon = areaIcon(insight.affectedArea);
          return (
            <Card key={insight.id} className={`border-l-4 ${cfg.border}`} data-testid={`op-insight-card-${insight.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={cfg.badge}>{cfg.label}</Badge>
                    <Badge variant="outline" className="gap-1">
                      <AreaIcon className="h-3 w-3" />
                      {insight.affectedArea}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(insight.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-semibold leading-snug" data-testid={`op-insight-observation-${insight.id}`}>
                    {insight.observation}
                  </p>
                </div>
                {insight.whyItMatters && (
                  <div className={`rounded-lg p-3 border-l-2 ${cfg.border} ${cfg.bg}`}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Why it matters
                    </p>
                    <p
                      className="text-sm leading-relaxed"
                      data-testid={`op-insight-why-${insight.id}`}
                    >
                      {insight.whyItMatters}
                    </p>
                  </div>
                )}
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Recommended action</p>
                  <p className="text-sm leading-relaxed">{insight.recommendedAction}</p>
                </div>

                {statusTab === "active" && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => openActDialog(insight)}
                      data-testid={`op-insight-act-${insight.id}`}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      Act on this
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDismissTarget(insight)}
                      data-testid={`op-insight-dismiss-${insight.id}`}
                    >
                      <X className="h-4 w-4 mr-1.5" />
                      Dismiss
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>

      {/* Dismiss dialog */}
      <Dialog open={!!dismissTarget} onOpenChange={(open) => !open && setDismissTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss this insight</DialogTitle>
            <DialogDescription>
              Tell MAinager why this isn't useful so it can avoid similar suggestions next time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm bg-muted/40 rounded-md p-3">
              {dismissTarget?.observation}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dismiss-reason">Why dismiss? (optional)</Label>
              <Textarea
                id="dismiss-reason"
                placeholder="e.g. Already handled, not relevant, planned this way…"
                value={dismissReason}
                onChange={e => setDismissReason(e.target.value)}
                rows={3}
                data-testid="dismiss-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDismissTarget(null)}>Cancel</Button>
            <Button
              onClick={() => dismissTarget && dismissMutation.mutate({ id: dismissTarget.id, reason: dismissReason })}
              disabled={dismissMutation.isPending}
              data-testid="dismiss-confirm"
            >
              {dismissMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Act-on dialog */}
      <Dialog open={!!actTarget} onOpenChange={(open) => !open && setActTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create action task</DialogTitle>
            <DialogDescription>
              We'll add this to your task list and link it back to this insight.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="act-title">Task title</Label>
              <Input
                id="act-title"
                value={actTaskTitle}
                onChange={e => setActTaskTitle(e.target.value)}
                data-testid="act-task-title-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-desc">Notes</Label>
              <Textarea
                id="act-desc"
                value={actTaskDescription}
                onChange={e => setActTaskDescription(e.target.value)}
                rows={5}
                data-testid="act-task-description-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActTarget(null)}>Cancel</Button>
            <Button
              onClick={() => actTarget && actMutation.mutate({ id: actTarget.id, taskTitle: actTaskTitle, taskDescription: actTaskDescription })}
              disabled={actMutation.isPending}
              data-testid="act-confirm"
            >
              {actMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
