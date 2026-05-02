import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Sparkles, Send, Loader2, X, RotateCcw } from "lucide-react";

interface AraAnswer {
  answer: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "ara-conversation-v1";
const MAX_HISTORY_FOR_CONTEXT = 10;

function loadMessages(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        m && typeof m.id === "string" && typeof m.content === "string" &&
        (m.role === "user" || m.role === "assistant")
    );
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // ignore quota / private-mode errors
  }
}

function clearStoredMessages() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function AskAraSheet() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-ask-ara", handler);
    return () => window.removeEventListener("open-ask-ara", handler);
  }, []);

  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 200);
      setTimeout(() => scrollEndRef.current?.scrollIntoView({ behavior: "auto" }), 250);
    }
  }, [open]);

  useEffect(() => {
    saveMessages(messages);
    if (messages.length > 0) {
      setTimeout(() => scrollEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages]);

  const askMutation = useMutation({
    mutationFn: async (q: string): Promise<AraAnswer> => {
      const history = messages.slice(-MAX_HISTORY_FOR_CONTEXT).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await apiRequest("POST", "/api/ara/ask", { question: q, history });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.answer,
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "Sorry, I had trouble answering that. Please try again.",
        },
      ]);
    },
  });

  const handleSubmit = () => {
    const q = question.trim();
    if (!q || askMutation.isPending) return;
    setMessages((prev) => [
      ...prev,
      { id: `q-${Date.now()}`, role: "user", content: q },
    ]);
    setQuestion("");
    askMutation.mutate(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    clearStoredMessages();
    setQuestion("");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const hasMessages = messages.length > 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <SheetTitle className="text-white text-sm font-semibold leading-tight">Ask Ara</SheetTitle>
                <p className="text-[11px] text-white/80 leading-tight">AI-powered knowledge assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasMessages && (
                <button
                  onClick={handleNewConversation}
                  className="p-1.5 hover:bg-white/20 rounded-full transition-colors flex items-center gap-1 text-[11px] px-2"
                  title="Start a new conversation"
                  data-testid="button-ara-new-conversation"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>New</span>
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="px-4 py-4 space-y-3">
            {!hasMessages && !askMutation.isPending && (
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/30 dark:to-indigo-900/30 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-violet-600 dark:text-violet-400" />
                </div>
                <p className="text-sm font-medium mb-1">Hi, I'm Ara!</p>
                <p className="text-sm text-muted-foreground">
                  Ask me anything about your store's procedures, policies, or how to handle any situation.
                </p>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="rounded-xl bg-muted/60 p-3.5" data-testid={`message-user-${m.id}`}>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-violet-500" />
                    Your question
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                </div>
              ) : (
                <div
                  key={m.id}
                  className="rounded-xl border border-violet-200 dark:border-violet-800/40 bg-violet-50 dark:bg-violet-950/20 p-3.5"
                  data-testid={`message-assistant-${m.id}`}
                >
                  <p className="text-xs font-medium text-violet-700 dark:text-violet-300 mb-1.5 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Ara's answer
                  </p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                </div>
              )
            )}

            {askMutation.isPending && (
              <div className="flex items-center gap-2 px-1 py-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <span className="text-xs">Ara is thinking...</span>
              </div>
            )}

            <div ref={scrollEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-border px-4 py-3 shrink-0">
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              placeholder={hasMessages ? "Ask a follow-up question..." : "Ask anything about store procedures, policies..."}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={askMutation.isPending}
              className="min-h-[40px] max-h-[120px] resize-none text-sm rounded-xl border-border focus-visible:ring-violet-500"
              rows={2}
              data-testid="input-ara-question"
            />
            <Button
              onClick={handleSubmit}
              disabled={!question.trim() || askMutation.isPending}
              size="icon"
              className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shrink-0"
              data-testid="button-ara-send"
            >
              {askMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">Press Enter to send, Shift+Enter for new line</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
