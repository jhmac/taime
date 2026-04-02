import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles, X, Minus, Send, Loader2, ThumbsUp, ThumbsDown,
  BookOpen, AlertTriangle, ClipboardList, Calendar,
  CheckCircle2, MessageSquarePlus,
} from "lucide-react";
import { useLocation } from "wouter";

interface MAinagerResponse {
  answer: string;
  confidence: "high" | "medium" | "low";
  referencedSops: { templateId: string; title: string }[];
  suggestedActions: { type: string; id?: string; label: string }[];
  conversationId: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  confidence?: "high" | "medium" | "low";
  referencedSops?: { templateId: string; title: string }[];
  suggestedActions?: { type: string; id?: string; label: string }[];
  feedbackGiven?: "up" | "down" | null;
}

function getTimeGreeting(name: string): string {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}!`;
  if (hour < 17) return `Good afternoon, ${name}!`;
  return `Good evening, ${name}!`;
}

function getQuickSuggestions(): { text: string; full: string }[] {
  const hour = new Date().getHours();
  const suggestions: { text: string; full: string }[] = [];

  if (hour < 11) {
    suggestions.push(
      { text: "What should I do first?", full: "What should I be doing first today?" },
      { text: "Who's working today?", full: "Who's working today and what are the shift times?" },
    );
  } else if (hour < 16) {
    suggestions.push(
      { text: "How are sales today?", full: "How are sales going today?" },
      { text: "Any open issues?", full: "Are there any open issues I should know about?" },
    );
  } else {
    suggestions.push(
      { text: "Closing checklist?", full: "What's left on the closing checklist?" },
      { text: "End of day tasks?", full: "What tasks do I still need to finish today?" },
    );
  }

  suggestions.push(
    { text: "Help me find a procedure", full: "I need help finding a procedure. Can you help?" },
    { text: "Report a problem", full: "I want to report a problem at the store." },
  );

  return suggestions;
}

export default function AskMAinagerSheet() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackMsgId, setFeedbackMsgId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [pulseVisible, setPulseVisible] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const userName = user?.firstName || "there";
  const storeName = "your store";

  useEffect(() => {
    const timer = setTimeout(() => setPulseVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-ask-mainager", handler);
    return () => window.removeEventListener("open-ask-mainager", handler);
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      return fetchWithTimeout("POST", "/api/ai/ask", {
        question,
        conversationId: conversationId || undefined,
      }, 15000) as Promise<MAinagerResponse>;
    },
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setRetryCount(0);
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        timestamp: new Date(),
        confidence: data.confidence,
        referencedSops: data.referencedSops,
        suggestedActions: data.suggestedActions,
        feedbackGiven: null,
      };
      setMessages(prev => [...prev, aiMsg]);
    },
    onError: (error: Error, question: string) => {
      if (retryCount < 1) {
        setRetryCount(prev => prev + 1);
        const retryMsg: ChatMessage = {
          id: `retry-${Date.now()}`,
          role: "assistant",
          content: "Taking a moment... Let me try that again.",
          timestamp: new Date(),
          confidence: "low",
        };
        setMessages(prev => [...prev, retryMsg]);
        setTimeout(() => askMutation.mutate(question), 1500);
        return;
      }
      setRetryCount(0);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "I'm having a little trouble right now. Try again in a moment, or check the SOP Library directly.",
        timestamp: new Date(),
        confidence: "low",
      };
      setMessages(prev => [...prev, errorMsg]);
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: async (data: { conversationId: string; messageIndex: number; helpful: boolean; feedbackText?: string }) => {
      const res = await apiRequest("POST", "/api/ai/feedback", data);
      return res.json();
    },
  });

  const handleSend = () => {
    const q = input.trim();
    if (!q || askMutation.isPending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setRetryCount(0);
    askMutation.mutate(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    setRetryCount(0);
  };

  const handleFeedback = (msgId: string, helpful: boolean) => {
    if (!conversationId) return;
    const msgIndex = messages.filter(m => m.role === "assistant").findIndex(m => m.id === msgId);
    if (msgIndex < 0) return;

    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedbackGiven: helpful ? "up" : "down" } : m));

    if (!helpful) {
      setFeedbackMsgId(msgId);
    } else {
      feedbackMutation.mutate({ conversationId, messageIndex: msgIndex, helpful: true });
      setFeedbackMsgId(null);
    }
  };

  const submitFeedbackText = (msgId: string) => {
    if (!conversationId) return;
    const msgIndex = messages.filter(m => m.role === "assistant").findIndex(m => m.id === msgId);
    if (msgIndex < 0) return;

    feedbackMutation.mutate({
      conversationId,
      messageIndex: msgIndex,
      helpful: false,
      feedbackText: feedbackText || undefined,
    });
    setFeedbackMsgId(null);
    setFeedbackText("");
  };

  const handleAction = (action: { type: string; id?: string; label: string }) => {
    setIsOpen(false);
    switch (action.type) {
      case "start_sop":
        if (action.id) navigate(`/sops/${action.id}`);
        else navigate("/sops");
        break;
      case "create_issue":
        navigate("/issues");
        break;
      case "view_schedule":
        navigate("/schedules");
        break;
      case "view_tasks":
        navigate("/tasks");
        break;
      default:
        break;
    }
  };

  const handleQuickSuggestion = (text: string) => {
    if (askMutation.isPending) return;
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setRetryCount(0);
    askMutation.mutate(text);
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  const isEmptyState = messages.length === 0;
  const suggestions = getQuickSuggestions();

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-32 right-4 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg hover:shadow-xl transition-all hover:scale-105 flex flex-col items-center justify-center gap-0.5 md:bottom-20"
        aria-label="Ask MAinager"
      >
        <Sparkles className="h-5 w-5" />
        <span className="text-[9px] font-semibold leading-none">Ask</span>
        {pulseVisible && (
          <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping opacity-40 pointer-events-none" />
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[60] md:inset-auto md:bottom-4 md:right-4 md:w-[420px] md:h-[600px] md:rounded-2xl md:shadow-2xl flex flex-col bg-background border border-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-semibold text-sm leading-tight">MAinager</h2>
                <p className="text-[11px] text-white/80 leading-tight">
                  {isEmptyState ? getTimeGreeting(userName) + " How can I help?" : "Your AI assistant"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={handleNewConversation} className="p-1.5 hover:bg-white/20 rounded-full transition-colors" title="New conversation">
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-white/20 rounded-full transition-colors md:hidden" title="Minimize">
                <Minus className="h-4 w-4" />
              </button>
              <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-white/20 rounded-full transition-colors" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 space-y-3">
              {isEmptyState && (
                <div className="text-center py-6">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/30 dark:to-indigo-900/30 flex items-center justify-center">
                    <Sparkles className="h-8 w-8 text-violet-600 dark:text-violet-400" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Hey {userName}! I'm MAinager, your AI assistant. I know all about {storeName}'s procedures, schedules, and data. Ask me anything!
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleQuickSuggestion(s.full)}
                        className="text-left text-xs p-2.5 rounded-lg border border-border hover:bg-accent hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
                      >
                        {s.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id}>
                  <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`flex gap-2 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                      {msg.role === "assistant" && (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                          <Sparkles className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}
                      <div>
                        <div className={`rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                          msg.role === "user"
                            ? "bg-violet-600 text-white rounded-br-md"
                            : "bg-muted rounded-bl-md"
                        }`}>
                          {msg.content}
                        </div>
                        <p className={`text-[10px] mt-0.5 px-1 ${
                          msg.role === "user" ? "text-right text-muted-foreground" : "text-muted-foreground"
                        }`}>
                          {formatTime(msg.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {msg.role === "assistant" && msg.confidence && msg.confidence !== "high" && (
                    <div className="ml-9 mt-1">
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {msg.confidence === "medium"
                          ? "I'm fairly sure about this, but you may want to double-check."
                          : "I'm not sure about this — the answer may not be in our procedures yet."}
                      </p>
                    </div>
                  )}

                  {msg.referencedSops && msg.referencedSops.length > 0 && (
                    <div className="ml-9 mt-1.5 flex flex-wrap gap-1.5">
                      {msg.referencedSops.map((sop) => (
                        <button
                          key={sop.templateId}
                          onClick={() => { setIsOpen(false); navigate(`/sops/${sop.templateId}`); }}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
                        >
                          <BookOpen className="h-3 w-3" />
                          {sop.title}
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                    <div className="ml-9 mt-2 flex flex-wrap gap-1.5">
                      {msg.suggestedActions.map((action, i) => (
                        <Button
                          key={i}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                          onClick={() => handleAction(action)}
                        >
                          {action.type === "start_sop" && <BookOpen className="h-3 w-3 mr-1" />}
                          {action.type === "create_issue" && <AlertTriangle className="h-3 w-3 mr-1" />}
                          {action.type === "view_tasks" && <ClipboardList className="h-3 w-3 mr-1" />}
                          {action.type === "view_schedule" && <Calendar className="h-3 w-3 mr-1" />}
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {msg.role === "assistant" && msg.feedbackGiven !== undefined && (
                    <div className="ml-9 mt-1.5 flex items-center gap-1">
                      {msg.feedbackGiven === null ? (
                        <>
                          <button
                            onClick={() => handleFeedback(msg.id, true)}
                            className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-muted-foreground hover:text-green-600 transition-colors"
                            title="Helpful"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleFeedback(msg.id, false)}
                            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                            title="Not helpful"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          Thanks for the feedback
                        </span>
                      )}
                    </div>
                  )}

                  {feedbackMsgId === msg.id && (
                    <div className="ml-9 mt-2 flex gap-1.5">
                      <input
                        type="text"
                        placeholder="What was wrong? (optional)"
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                        onKeyDown={(e) => { if (e.key === "Enter") submitFeedbackText(msg.id); }}
                      />
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => submitFeedbackText(msg.id)}>
                        Send
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {askMutation.isPending && (
                <div className="flex justify-start">
                  <div className="flex gap-2 max-w-[85%]">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        MAinager is thinking...
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {!isEmptyState && (
            <div className="px-4 py-1.5 border-t border-border">
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
                {suggestions.slice(0, 3).map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuickSuggestion(s.full)}
                    disabled={askMutation.isPending}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-border hover:bg-accent whitespace-nowrap shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border p-3 shrink-0">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                placeholder="Ask me anything about the store..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={askMutation.isPending}
                className="min-h-[40px] max-h-[100px] resize-none text-sm rounded-xl border-border focus-visible:ring-violet-500"
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || askMutation.isPending}
                size="icon"
                className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shrink-0"
              >
                {askMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
