import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquareQuestion,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
  AlertTriangle,
  User,
  Clock,
} from "lucide-react";

interface UnansweredQuestion {
  id: string;
  question: string;
  aiAnswer: string | null;
  status: string;
  answer: string | null;
  conversationId: string | null;
  askedAt: string;
  answeredAt: string | null;
  askedByUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

function QuestionCard({ q, onAnswered }: { q: UnansweredQuestion; onAnswered: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showAiAnswer, setShowAiAnswer] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const answerMutation = useMutation({
    mutationFn: async (answer: string) => {
      const res = await apiRequest("POST", `/api/ai/questions/${q.id}/answer`, { answer });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Answer submitted", description: "The answer has been saved and added to the knowledge base." });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/questions/count"] });
      onAnswered();
    },
    onError: () => {
      toast({ title: "Failed to submit answer", variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ai/questions/${q.id}/dismiss`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Question dismissed" });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/questions/count"] });
      onAnswered();
    },
  });

  const userName = q.askedByUser
    ? `${q.askedByUser.firstName || ""} ${q.askedByUser.lastName || ""}`.trim() || "Team Member"
    : "Team Member";

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <Card className="border-amber-200/70 dark:border-amber-800/40 hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0 mt-0.5">
            <MessageSquareQuestion className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm leading-snug">{q.question}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" /> {userName}
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> {timeAgo(q.askedAt)}
              </span>
            </div>

            {q.aiAnswer && (
              <button
                onClick={() => setShowAiAnswer(!showAiAnswer)}
                className="mt-2 text-[11px] text-violet-600 dark:text-violet-400 flex items-center gap-1 hover:underline"
              >
                {showAiAnswer ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAiAnswer ? "Hide AI response" : "See what MAinager said"}
              </button>
            )}

            {showAiAnswer && q.aiAnswer && (
              <div className="mt-2 p-2.5 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-800/30">
                <p className="text-[11px] text-violet-800 dark:text-violet-200 leading-relaxed whitespace-pre-wrap">{q.aiAnswer}</p>
                <p className="text-[10px] text-violet-500 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" /> Low confidence — that's why it was flagged
                </p>
              </div>
            )}

            {!expanded ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-7 text-xs"
                onClick={() => setExpanded(true)}
              >
                Answer this question
              </Button>
            ) : (
              <div className="mt-3 space-y-2">
                <Textarea
                  placeholder="Type your official answer here — this will be added to the knowledge base so MAinager can answer similar questions in the future."
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  className="text-sm min-h-[80px] resize-none"
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => answerMutation.mutate(answerText)}
                    disabled={!answerText.trim() || answerMutation.isPending}
                  >
                    {answerMutation.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3 mr-1" />
                    )}
                    Submit Answer
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setExpanded(false)}
                    disabled={answerMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground ml-auto"
                    onClick={() => dismissMutation.mutate()}
                    disabled={dismissMutation.isPending}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            {!expanded && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 text-xs text-muted-foreground"
                onClick={() => dismissMutation.mutate()}
                disabled={dismissMutation.isPending}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AIQuestionsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"pending" | "answered">("pending");
  const [refreshKey, setRefreshKey] = useState(0);

  const roleName = user?.role?.name;
  const isAdmin = roleName === "admin" || roleName === "owner" || roleName === "manager";

  const { data, isLoading } = useQuery<{ success: boolean; data: UnansweredQuestion[] }>({
    queryKey: ["/api/ai/questions", tab, refreshKey],
    queryFn: async () => {
      const res = await fetch(`/api/ai/questions?status=${tab}`, { credentials: "include" });
      return res.json();
    },
    enabled: isAdmin,
  });

  const questions = data?.data || [];

  if (!isAdmin) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center p-8">
        <div className="text-center">
          <MessageSquareQuestion className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">You don't have access to this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 text-white p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <MessageSquareQuestion className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold">AI Questions Queue</h1>
            <p className="text-sm opacity-80">Questions MAinager couldn't confidently answer</p>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4">
        <div className="flex gap-2 mb-4">
          <Button
            variant={tab === "pending" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("pending")}
          >
            Pending
          </Button>
          <Button
            variant={tab === "answered" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("answered")}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Answered
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
        ) : questions.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-3" />
            <p className="font-medium">
              {tab === "pending" ? "No pending questions" : "No answered questions yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {tab === "pending"
                ? "MAinager is answering questions with confidence!"
                : "Answer pending questions to build the knowledge base."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tab === "answered" ? (
              questions.map(q => (
                <Card key={q.id} className="border-green-200/50 dark:border-green-800/30">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{q.question}</p>
                        {q.answer && (
                          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{q.answer}</p>
                        )}
                        {q.answeredAt && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Answered {new Date(q.answeredAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              questions.map(q => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  onAnswered={() => setRefreshKey(k => k + 1)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
