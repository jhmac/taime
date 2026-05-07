import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowLeft, Send, Bot, User, MessageSquare, Loader2,
  BookOpen, BarChart2, ChevronRight, Plus
} from "lucide-react";

interface QASession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface QAMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  sourceDocumentIds?: string[];
  createdAt: string;
}

interface AskResponse {
  sessionId: string;
  message: string;
  messageId: string;
  sourceDocumentIds: string[];
}

interface Analytics {
  topQuestions: Array<{ question: string; count: number }>;
  totalQuestions: number;
  period: string;
}

export default function StoreQA() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isManager = user?.role?.name === "owner" || user?.role?.name === "admin" || user?.role?.name === "manager";

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<QASession[]>({
    queryKey: ["/api/ai/ask/sessions"],
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery<QAMessage[]>({
    queryKey: ["/api/ai/ask/sessions", activeSessionId, "messages"],
    enabled: !!activeSessionId,
  });

  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["/api/ai/ask/analytics"],
    enabled: isManager && showAnalytics,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/ask/sessions", {});
      return res.json() as Promise<QASession>;
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/ask/sessions"] });
      setActiveSessionId(session.id);
    },
    onError: () => toast({ title: "Error", description: "Failed to start new conversation", variant: "destructive" }),
  });

  const askMutation = useMutation({
    mutationFn: async (question: string): Promise<AskResponse> => {
      const res = await apiRequest("POST", "/api/ai/ask", {
        questionText: question,
        sessionId: activeSessionId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (!activeSessionId) {
        setActiveSessionId(data.sessionId);
        queryClient.invalidateQueries({ queryKey: ["/api/ai/ask/sessions"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ai/ask/sessions", data.sessionId, "messages"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to get answer. Please try again.", variant: "destructive" }),
  });

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || askMutation.isPending) return;
    setInputText("");
    askMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const EXAMPLE_QUESTIONS = [
    "What do I say when a customer asks about our return policy?",
    "How do I handle a customer who seems unsure about sizing?",
    "What are the steps for opening the store?",
    "How do I approach a customer without being pushy?",
  ];

  if (showAnalytics && isManager) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(false)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">Q&A Analytics</h1>
        </div>
        {!analytics ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold">{analytics.totalQuestions}</p>
                  <p className="text-xs text-muted-foreground">Total Questions</p>
                  <p className="text-xs text-muted-foreground">{analytics.period}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold">{analytics.topQuestions.length}</p>
                  <p className="text-xs text-muted-foreground">Unique Topics</p>
                  <p className="text-xs text-muted-foreground">in the last 30 days</p>
                </CardContent>
              </Card>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Top 10 Questions</h3>
              <div className="space-y-2">
                {analytics.topQuestions.map((q, i) => (
                  <Card key={i}>
                    <CardContent className="pt-3 pb-3 flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground font-medium mt-0.5 w-5">#{i + 1}</span>
                        <p className="text-sm">{q.question}</p>
                      </div>
                      <Badge variant="secondary" className="flex-shrink-0">{q.count}×</Badge>
                    </CardContent>
                  </Card>
                ))}
                {analytics.topQuestions.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No questions asked yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!activeSessionId && !messagesLoading) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/learning")}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-xl font-bold">Ask the Store AI</h1>
              <p className="text-sm text-muted-foreground">Answers grounded in your store's knowledge base</p>
            </div>
          </div>
          {isManager && (
            <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(true)}>
              <BarChart2 className="w-4 h-4 mr-1" /> Analytics
            </Button>
          )}
        </div>

        <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20">
          <Bot className="w-8 h-8 text-primary mb-2" />
          <p className="font-semibold">What would you like to know?</p>
          <p className="text-sm text-muted-foreground mt-1">Ask anything about store operations, policies, products, or sales techniques.</p>
        </div>

        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-2">Try asking:</p>
          <div className="space-y-2">
            {EXAMPLE_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => { setInputText(q); createSessionMutation.mutate(); }}
                className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors text-sm flex items-center justify-between gap-2"
              >
                <span>{q}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {sessions.length > 0 && (
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Recent conversations</p>
            <div className="space-y-2">
              {sessions.slice(0, 5).map(session => (
                <button
                  key={session.id}
                  onClick={() => setActiveSessionId(session.id)}
                  className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors text-sm flex items-center gap-2"
                >
                  <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{session.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Type your question..."
            onKeyDown={e => {
              if (e.key === "Enter" && inputText.trim()) {
                if (!activeSessionId) {
                  createSessionMutation.mutate();
                } else {
                  handleSend();
                }
              }
            }}
            className="flex-1"
          />
          <Button
            onClick={() => { if (!activeSessionId) createSessionMutation.mutate(); else handleSend(); }}
            disabled={!inputText.trim() || createSessionMutation.isPending}
          >
            {createSessionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-page-chat max-w-2xl mx-auto overflow-hidden" style={{ overscrollBehavior: "none" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setActiveSessionId(null)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <p className="font-semibold text-sm">Ask the Store AI</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> Grounded in your knowledge base
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => { setActiveSessionId(null); createSessionMutation.mutate(); }}>
            <Plus className="w-4 h-4" />
          </Button>
          {isManager && (
            <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(true)}>
              <BarChart2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messagesLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-3/4 rounded-xl" />
            <Skeleton className="h-16 w-3/4 rounded-xl ml-auto" />
          </div>
        )}

        {messages.length === 0 && !messagesLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Ask any question about your store</p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={`max-w-[80%] ${msg.role === "user" ? "order-first" : ""}`}>
              <div className={`p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-muted rounded-tl-sm"
              }`}>
                {msg.content}
              </div>
              {msg.role === "assistant" && msg.sourceDocumentIds && msg.sourceDocumentIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1 pl-1">
                  <BookOpen className="w-3 h-3 inline mr-1" />
                  Sourced from knowledge base
                </p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-4 h-4 text-primary" />
              </div>
            )}
          </div>
        ))}

        {askMutation.isPending && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="p-3 rounded-2xl bg-muted rounded-tl-sm">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="px-4 py-3 border-t bg-background/95 backdrop-blur-sm">
        <div className="flex gap-2">
          <Input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Ask anything about your store..."
            onKeyDown={handleKeyDown}
            disabled={askMutation.isPending}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={!inputText.trim() || askMutation.isPending} size="icon">
            {askMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
