import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sparkles, ClipboardList, Lightbulb, BarChart3, PartyPopper,
  ChevronLeft, ChevronRight, Inbox, AlertTriangle, Clock,
  CheckCircle2, ArrowRight, Loader2, FolderOpen, Rocket,
} from "lucide-react";

interface ReviewData {
  id: string;
  status: string;
  notes: string | null;
  aiContent: any;
  ai_content?: any;
}

const STEPS = [
  { title: "Get Clear", icon: Sparkles, emoji: "🧹", color: "from-blue-500 to-cyan-500" },
  { title: "Get Current", icon: ClipboardList, emoji: "📋", color: "from-purple-500 to-indigo-500" },
  { title: "Get Creative", icon: Lightbulb, emoji: "💡", color: "from-amber-500 to-orange-500" },
  { title: "Week in Review", icon: BarChart3, emoji: "📊", color: "from-emerald-500 to-green-500" },
  { title: "You're Set!", icon: PartyPopper, emoji: "✨", color: "from-pink-500 to-rose-500" },
];

const CHECKLIST_KEYS = {
  0: ["inbox_processed", "loose_papers", "email_checked"],
  1: ["projects_reviewed", "overdue_addressed", "followups_sent"],
  2: ["someday_reviewed"],
} as Record<number, string[]>;

const CHECKLIST_LABELS: Record<string, string> = {
  inbox_processed: "Inbox processed to zero",
  loose_papers: "Collected any loose papers/notes",
  email_checked: "Checked email for action items",
  projects_reviewed: "All projects reviewed",
  overdue_addressed: "Overdue actions addressed",
  followups_sent: "Follow-ups sent",
  someday_reviewed: "Someday/maybe reviewed",
};

export default function WeeklyReview() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("weekly_review_checklist");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const { data, isLoading } = useQuery<{ success: boolean; data: ReviewData }>({
    queryKey: ["/api/gtd/review/current"],
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      return await apiRequest("PUT", "/api/gtd/review/current", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/review/current"] });
    },
  });

  const review = data?.data;
  const content = review?.aiContent || review?.ai_content || {};

  useEffect(() => {
    if (review && review.status === "pending") {
      updateMutation.mutate({ status: "in_progress" });
    }
  }, [review?.id]);

  useEffect(() => {
    if (review?.notes) setNotes(review.notes);
  }, [review?.notes]);

  useEffect(() => {
    localStorage.setItem("weekly_review_checklist", JSON.stringify(checklist));
  }, [checklist]);

  const toggleCheck = (key: string) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const completeReview = () => {
    updateMutation.mutate({ status: "completed", notes }, {
      onSuccess: () => {
        localStorage.removeItem("weekly_review_checklist");
        toast({ title: "Weekly review complete! You're going into next week organized and ready. 💪", duration: 4000 });
      },
    });
  };

  const saveNotes = () => {
    updateMutation.mutate({ notes });
    toast({ title: "Notes saved", duration: 1500 });
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!review || !content.greeting) {
    return (
      <div className="max-w-2xl mx-auto p-4 text-center py-16">
        <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">Weekly Review</h2>
        <p className="text-muted-foreground mb-4">Your review is being prepared...</p>
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (review.status === "completed") {
    return (
      <div className="max-w-2xl mx-auto p-4 text-center py-16">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold mb-2">Review Complete!</h2>
        <p className="text-muted-foreground mb-6">You're organized and ready for next week.</p>
        {review.notes && (
          <Card className="mb-6 text-left">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Your Notes</h3>
              <p className="text-sm whitespace-pre-wrap">{review.notes}</p>
            </CardContent>
          </Card>
        )}
        <Button variant="outline" onClick={() => navigate("/")}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const currentStep = STEPS[step];
  const StepIcon = currentStep.icon;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 pb-24">
      <div className={`rounded-xl bg-gradient-to-r ${currentStep.color} p-5 text-white`}>
        <div className="flex items-center gap-3 mb-2">
          <StepIcon className="h-6 w-6" />
          <h1 className="text-xl font-bold">{currentStep.emoji} {currentStep.title}</h1>
        </div>
        {step === 0 && <p className="text-white/80 text-sm">{content.greeting}</p>}
      </div>

      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            className={`flex-1 h-2 rounded-full transition-colors ${
              i <= step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground text-center">Step {step + 1} of {STEPS.length}</p>

      {step === 0 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                  <Inbox className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="font-semibold">Inbox Status</h3>
                  <p className="text-sm text-muted-foreground">
                    {content.inbox_status?.unprocessed_count || 0} unprocessed
                    {" · "}
                    {content.inbox_status?.processed_this_week || 0} processed this week
                  </p>
                </div>
              </div>
              <p className="text-sm mb-3">{content.inbox_status?.message}</p>
              <Button variant="outline" size="sm" onClick={() => navigate("/gtd/inbox")}>
                Process your inbox <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground">Checklist</h3>
              {(CHECKLIST_KEYS[0] || []).map(key => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <Checkbox checked={!!checklist[key]} onCheckedChange={() => toggleCheck(key)} />
                  <span className="text-sm">{CHECKLIST_LABELS[key]}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {content.projects_review?.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" /> Active Projects
                </h3>
                <div className="space-y-4">
                  {content.projects_review.map((p: any, i: number) => (
                    <div key={i} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-medium text-sm">{p.project_title}</h4>
                        <Badge variant="outline" className="text-xs">
                          {p.progress || 0}%
                        </Badge>
                      </div>
                      <Progress value={p.progress || 0} className="h-1.5 mb-2" />
                      <p className="text-xs text-muted-foreground mb-1">{p.status_note}</p>
                      {p.suggested_next_step && (
                        <p className="text-xs text-primary">
                          <Rocket className="h-3 w-3 inline mr-1" />
                          {p.suggested_next_step}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <h3 className="font-semibold">Overdue Actions ({content.overdue_actions?.count || 0})</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{content.overdue_actions?.message}</p>
              {content.overdue_actions?.items?.length > 0 && (
                <div className="space-y-1">
                  {content.overdue_actions.items.slice(0, 5).map((a: any) => (
                    <div key={a.id} className="text-sm flex items-center gap-2 p-2 bg-red-50 dark:bg-red-950/10 rounded">
                      <Clock className="h-3 w-3 text-red-500" />
                      <span className="truncate">{a.title}</span>
                    </div>
                  ))}
                </div>
              )}
              {(content.overdue_actions?.count || 0) > 0 && (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/gtd/actions")}>
                  Review actions <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold">Waiting For ({content.waiting_for_check?.overdue_count || 0} overdue)</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{content.waiting_for_check?.message}</p>
              {content.waiting_for_check?.items?.length > 0 && (
                <div className="space-y-1">
                  {content.waiting_for_check.items.slice(0, 5).map((w: any) => (
                    <div key={w.id} className="text-sm flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/10 rounded">
                      <span className="truncate">Waiting on: {w.waitingOn}</span>
                    </div>
                  ))}
                </div>
              )}
              {(content.waiting_for_check?.overdue_count || 0) > 0 && (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/gtd/waiting")}>
                  Review waiting items <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground">Checklist</h3>
              {(CHECKLIST_KEYS[1] || []).map(key => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <Checkbox checked={!!checklist[key]} onCheckedChange={() => toggleCheck(key)} />
                  <span className="text-sm">{CHECKLIST_LABELS[key]}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm italic text-amber-700 dark:text-amber-400 mb-4">
                "{content.someday_maybe_prompt}"
              </p>
              {content.someday_items?.length > 0 ? (
                <div className="space-y-2">
                  {content.someday_items.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between p-2 border rounded-lg">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{s.title}</span>
                        {s.category && (
                          <Badge variant="secondary" className="ml-2 text-xs">{s.category}</Badge>
                        )}
                      </div>
                      <div className="flex gap-1 ml-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => navigate("/gtd/someday")}
                        >
                          Review
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No items in your someday/maybe list.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground">Checklist</h3>
              {(CHECKLIST_KEYS[2] || []).map(key => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <Checkbox checked={!!checklist[key]} onCheckedChange={() => toggleCheck(key)} />
                  <span className="text-sm">{CHECKLIST_LABELS[key]}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2">This Week</h3>
              <p className="text-sm">{content.week_summary}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2">Sales</h3>
              <p className="text-sm text-muted-foreground">{content.sales_snapshot}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2">Improvements & Feedback</h3>
              <p className="text-sm text-muted-foreground">{content.improvement_insights}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2">SOPs</h3>
              <p className="text-sm text-muted-foreground">
                {content.sop_stats?.completed || 0} of {content.sop_stats?.total || 0} SOP executions completed this week
              </p>
              {(content.sop_stats?.total || 0) > 0 && (
                <Progress
                  value={content.sop_stats?.total ? (content.sop_stats.completed / content.sop_stats.total) * 100 : 0}
                  className="h-2 mt-2"
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-5 text-center">
              <div className="text-4xl mb-3">✨</div>
              <p className="text-sm">{content.closing_thought}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2">Personal Notes</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Anything you want to remember for next week?
              </p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Thoughts, reminders, reflections..."
                className="min-h-[100px] mb-2"
              />
              <Button variant="outline" size="sm" onClick={saveNotes} disabled={updateMutation.isPending}>
                Save Notes
              </Button>
            </CardContent>
          </Card>

          <Button
            className="w-full h-12 text-base"
            onClick={completeReview}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-5 w-5 mr-2" />
            )}
            Complete Review
          </Button>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t p-3 flex items-center justify-between max-w-2xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        <span className="text-xs text-muted-foreground">
          {step + 1} / {STEPS.length}
        </span>

        {step < STEPS.length - 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <div className="w-16" />
        )}
      </div>
    </div>
  );
}
