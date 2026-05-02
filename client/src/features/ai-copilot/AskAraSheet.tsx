import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Sparkles, Send, Loader2, X, RotateCcw, User, AlertCircle } from "lucide-react";

interface AraAnswer {
  answer: string;
}

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  isError?: boolean;
}

const STORAGE_KEY = "ara-conversation-v1";
const MAX_HISTORY_FOR_CONTEXT = 10;

let __idCounter = 0;
function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  __idCounter += 1;
  return `${prefix}-${Date.now()}-${__idCounter}`;
}

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

// Build a clean conversation history of only complete user→assistant pairs where the
// assistant reply was a real answer (not an error). When an assistant reply was an
// error, we also drop the user message it was answering so we don't accidentally pair
// that user question with a later, unrelated assistant reply.
//
// This protects the Anthropic API call from rejecting malformed message sequences and
// avoids feeding the model its own "Sorry, I had trouble..." error replies.
function buildHistoryForApi(messages: ChatMessage[]): { role: ChatRole; content: string }[] {
  const pairs: { role: ChatRole; content: string }[] = [];
  let i = 0;
  while (i < messages.length) {
    const userMsg = messages[i];
    if (userMsg.role !== "user") {
      i += 1;
      continue;
    }
    const assistantMsg = messages[i + 1];
    if (assistantMsg && assistantMsg.role === "assistant" && !assistantMsg.isError) {
      pairs.push({ role: "user", content: userMsg.content });
      pairs.push({ role: "assistant", content: assistantMsg.content });
      i += 2;
    } else {
      // Either no reply yet, or the reply was an error — drop this user turn from history.
      i += assistantMsg && assistantMsg.role === "assistant" ? 2 : 1;
    }
  }
  // Slice to the most recent N messages (always an even number to keep pairs intact).
  const maxMessages = MAX_HISTORY_FOR_CONTEXT - (MAX_HISTORY_FOR_CONTEXT % 2);
  return pairs.slice(-maxMessages);
}

interface ChatBubbleProps {
  message: ChatMessage;
}

function ChatBubble({ message }: ChatBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="rounded-xl bg-muted/60 p-3.5" data-testid={`message-user-${message.id}`}>
        <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
          <User className="h-3 w-3" />
          You
        </p>
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    );
  }

  if (message.isError) {
    return (
      <div
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5"
        data-testid={`message-error-${message.id}`}
      >
        <p className="text-xs font-medium text-destructive mb-1.5 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Couldn't answer
        </p>
        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-violet-200 dark:border-violet-800/40 bg-violet-50 dark:bg-violet-950/20 p-3.5"
      data-testid={`message-assistant-${message.id}`}
    >
      <p className="text-xs font-medium text-violet-700 dark:text-violet-300 mb-1.5 flex items-center gap-1">
        <Sparkles className="h-3 w-3" />
        Ara
      </p>
      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
    </div>
  );
}

export default function AskAraSheet() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Bumped whenever the user starts a new conversation. Mutations capture the
  // version at start time and discard their result if the version changed
  // (e.g. user reset while the request was in flight).
  const conversationVersionRef = useRef(0);

  // Helper that registers a timeout so we can clear pending ones on unmount.
  const trackTimeout = useCallback((cb: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimeoutsRef.current.delete(id);
      cb();
    }, ms);
    pendingTimeoutsRef.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-ask-ara", handler);
    return () => window.removeEventListener("open-ask-ara", handler);
  }, []);

  // Clear all pending timeouts on unmount to prevent late callbacks.
  useEffect(() => {
    return () => {
      pendingTimeoutsRef.current.forEach((id) => clearTimeout(id));
      pendingTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    trackTimeout(() => textareaRef.current?.focus(), 200);
    trackTimeout(() => scrollEndRef.current?.scrollIntoView({ behavior: "auto" }), 250);
  }, [open, trackTimeout]);

  useEffect(() => {
    saveMessages(messages);
    if (messages.length > 0) {
      trackTimeout(() => scrollEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages, trackTimeout]);

  const askMutation = useMutation<AraAnswer, Error, string, { versionAtStart: number }>({
    mutationFn: async (q: string): Promise<AraAnswer> => {
      const history = buildHistoryForApi(messages);
      const res = await apiRequest("POST", "/api/ara/ask", { question: q, history });
      return res.json();
    },
    // onMutate runs before mutationFn and its return value is passed as `context`
    // to onSuccess/onError. We snapshot the conversation version here so both
    // success and error handlers can discard stale (post-reset) responses.
    onMutate: () => ({ versionAtStart: conversationVersionRef.current }),
    onSuccess: (data, _q, context) => {
      if (context && context.versionAtStart !== conversationVersionRef.current) return;
      setMessages((prev) => [
        ...prev,
        { id: makeId("a"), role: "assistant", content: data.answer },
      ]);
    },
    onError: (err, _q, context) => {
      if (context && context.versionAtStart !== conversationVersionRef.current) return;
      const detail = err?.message && !err.message.startsWith("4") && !err.message.startsWith("5")
        ? err.message
        : "Sorry, I had trouble answering that. Please try again.";
      setMessages((prev) => [
        ...prev,
        { id: makeId("a"), role: "assistant", content: detail, isError: true },
      ]);
    },
  });

  const handleSubmit = useCallback(() => {
    const q = question.trim();
    if (!q || askMutation.isPending) return;
    setMessages((prev) => [
      ...prev,
      { id: makeId("q"), role: "user", content: q },
    ]);
    setQuestion("");
    askMutation.mutate(q);
  }, [question, askMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleNewConversation = () => {
    // Bump the conversation version so any in-flight response is discarded
    // when it eventually resolves (prevents stale answers leaking into a
    // freshly cleared chat).
    conversationVersionRef.current += 1;
    setMessages([]);
    clearStoredMessages();
    setQuestion("");
    trackTimeout(() => textareaRef.current?.focus(), 100);
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
                aria-label="Close"
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

            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}

            {askMutation.isPending && (
              <div
                className="flex items-center gap-2 px-1 py-2 text-muted-foreground"
                data-testid="ara-thinking-indicator"
              >
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
