import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidatePrefix } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare, Send, Plus, ArrowLeft, Loader2, ChevronUp, X, Pencil, Trash2, Check, Reply,
} from "lucide-react";
import { format, isToday, isYesterday, formatDistanceToNow } from "date-fns";
import NewThreadDialog from "./NewThreadDialog";

function getInitials(firstName?: string | null, lastName?: string | null) {
  return ((firstName?.charAt(0) || "") + (lastName?.charAt(0) || "")).toUpperCase() || "?";
}

function formatMessageTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday " + format(d, "h:mm a");
  return format(d, "MMM d, h:mm a");
}

function formatThreadTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

interface ThreadListItem {
  id: string;
  threadType: string;
  title: string | null;
  participants: { userId: string; firstName: string | null; lastName: string | null }[];
  lastMessage: { content: string; senderName: string; createdAt: string; messageType: string } | null;
  unreadCount: number;
  updatedAt: string;
}

interface Message {
  id: string;
  threadId: string;
  senderId: string;
  content: string;
  messageType: string;
  imageUrl: string | null;
  replyToId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  senderName: string;
  senderLastName: string;
  replyTo: { id: string; content: string; senderName: string } | null;
  tempId?: string;
  sending?: boolean;
}

interface ThreadDetail {
  thread: {
    id: string;
    threadType: string;
    title: string | null;
    participants: { userId: string; firstName: string | null; lastName: string | null; lastReadAt: string | null }[];
  };
  messages: Message[];
  hasMore: boolean;
}

export default function MessagingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { lastMessage: wsMessage } = useWebSocket();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [showNewThread, setShowNewThread] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingSentRef = useRef(0);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    const handler = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const { data: threadsData, isLoading: threadsLoading } = useQuery<{ success: boolean; data: ThreadListItem[] }>({
    queryKey: ["/api/messages/threads"],
    refetchInterval: 30000,
  });

  const { data: threadData, isLoading: threadLoading } = useQuery<{ success: boolean; data: ThreadDetail }>({
    queryKey: ["/api/messages/threads", selectedThreadId],
    enabled: !!selectedThreadId,
  });

  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 60000,
  });

  const threads = threadsData?.data || [];

  useEffect(() => {
    if (threadsLoading || selectedThreadId || threads.length === 0) return;
    const firstUnread = threads.find(t => (t.unreadCount ?? 0) > 0) ?? threads[0];
    if (firstUnread) handleSelectThread(firstUnread.id);
  }, [threads, threadsLoading]);

  useEffect(() => {
    if (threadData?.data?.messages) {
      setLocalMessages(threadData.data.messages);
    }
  }, [threadData]);

  useEffect(() => {
    if (!wsMessage) return;
    const { type, data } = wsMessage as any;

    if (type === "new_message" && data.threadId) {
      if (data.threadId === selectedThreadId) {
        setLocalMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        if (!userScrolledUpRef.current) {
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
        apiRequest("GET", `/api/messages/threads/${selectedThreadId}`).catch(() => {});
      }
      invalidatePrefix("/api/messages/threads");
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    }

    if (type === "message_confirmed" && data.tempId && data.threadId === selectedThreadId) {
      setLocalMessages(prev => prev.map(m =>
        m.tempId === data.tempId ? { ...data.message, sending: false } : m
      ));
    }

    if (type === "message_edited" && data.threadId === selectedThreadId) {
      setLocalMessages(prev => prev.map(m =>
        m.id === data.messageId ? { ...m, content: data.content, editedAt: data.editedAt } : m
      ));
    }

    if (type === "message_deleted" && data.threadId === selectedThreadId) {
      setLocalMessages(prev => prev.map(m =>
        m.id === data.messageId ? { ...m, content: "[Message deleted]", deletedAt: new Date().toISOString() } : m
      ));
    }

    if (type === "thread_created") {
      invalidatePrefix("/api/messages/threads");
    }

    if (type === "typing" && data.threadId === selectedThreadId) {
      setTypingUsers(prev => ({ ...prev, [data.userId]: data.userName }));
      setTimeout(() => {
        setTypingUsers(prev => {
          const next = { ...prev };
          delete next[data.userId];
          return next;
        });
      }, 3000);
    }

    if (type === "thread_read" && data.threadId === selectedThreadId) {
      invalidatePrefix("/api/messages/threads");
    }
  }, [wsMessage, selectedThreadId]);

  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; reply_to_id?: string; temp_id: string }) => {
      return await apiRequest("POST", `/api/messages/threads/${selectedThreadId}/messages`, payload);
    },
    onSuccess: () => {
      invalidatePrefix("/api/messages/threads");
    },
    onError: (err, variables) => {
      setLocalMessages(prev => prev.filter(m => m.tempId !== variables.temp_id));
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      return await apiRequest("PUT", `/api/messages/${id}`, { content });
    },
    onSuccess: (_, vars) => {
      setLocalMessages(prev => prev.map(m =>
        m.id === vars.id ? { ...m, content: vars.content, editedAt: new Date().toISOString() } : m
      ));
      setEditingMessage(null);
      setEditContent("");
    },
    onError: () => {
      toast({ title: "Failed to edit message", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/messages/${id}`);
    },
    onSuccess: (_, id) => {
      setLocalMessages(prev => prev.map(m =>
        m.id === id ? { ...m, content: "[Message deleted]", deletedAt: new Date().toISOString() } : m
      ));
    },
    onError: () => {
      toast({ title: "Failed to delete message", variant: "destructive" });
    },
  });

  const handleSend = useCallback(() => {
    const content = messageInput.trim();
    if (!content || !selectedThreadId || !user) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: Message = {
      id: tempId,
      threadId: selectedThreadId,
      senderId: user.id,
      content,
      messageType: "text",
      imageUrl: null,
      replyToId: replyTo?.id || null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      senderName: user.firstName || "You",
      senderLastName: user.lastName || "",
      replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, senderName: replyTo.senderName } : null,
      tempId,
      sending: true,
    };

    setLocalMessages(prev => [...prev, optimisticMessage]);
    setMessageInput("");
    setReplyTo(null);
    userScrolledUpRef.current = false;
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    sendMutation.mutate({ content, reply_to_id: replyTo?.id, temp_id: tempId });
  }, [messageInput, selectedThreadId, user, replyTo, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sendTypingIndicator = useCallback(() => {
    if (!selectedThreadId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    apiRequest("POST", "/api/messages/typing", { thread_id: selectedThreadId }).catch(() => {});
  }, [selectedThreadId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageInput(e.target.value);
    sendTypingIndicator();
  };

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = fromBottom > 150;
  }, []);

  useEffect(() => {
    if (!userScrolledUpRef.current && localMessages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 100);
    }
  }, [selectedThreadId]);

  const getThreadDisplayName = useCallback((thread: ThreadListItem) => {
    if (thread.title) return thread.title;
    if (!user) return "Thread";
    const others = thread.participants.filter(p => p.userId !== user.id);
    if (others.length === 0) return "Just you";
    return others.map(p => p.firstName || "Unknown").join(", ");
  }, [user]);

  const getThreadDetailName = useCallback((thread: ThreadDetail["thread"]) => {
    if (thread.title) return thread.title;
    if (!user) return "Thread";
    const others = thread.participants.filter(p => p.userId !== user.id);
    if (others.length === 0) return "Just you";
    return others.map(p => p.firstName || "Unknown").join(", ");
  }, [user]);

  const typingList = Object.values(typingUsers).filter(Boolean);

  const showConversation = selectedThreadId && (!isMobileView || selectedThreadId);
  const showThreadList = !isMobileView || !selectedThreadId;

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    setReplyTo(null);
    setEditingMessage(null);
    setLocalMessages([]);
    userScrolledUpRef.current = false;
  };

  const handleBack = () => {
    setSelectedThreadId(null);
    setReplyTo(null);
    setEditingMessage(null);
    invalidatePrefix("/api/messages");
  };

  const handleThreadCreated = (threadId: string) => {
    setShowNewThread(false);
    handleSelectThread(threadId);
    invalidatePrefix("/api/messages");
  };

  return (
    <div className="h-[calc(100vh-8rem)] md:h-[calc(100vh-4rem)] flex bg-background">
      {showThreadList && (
        <div className={`${isMobileView ? "w-full" : "w-80 border-r border-border"} flex flex-col`}>
          <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
            <h1 className="text-lg font-bold">Messages</h1>
            <Button size="sm" variant="outline" onClick={() => setShowNewThread(true)}>
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {threadsLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <MessageSquare className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No conversations yet</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowNewThread(true)}>
                  Start a conversation
                </Button>
              </div>
            ) : (
              threads.map(thread => (
                <button
                  key={thread.id}
                  onClick={() => handleSelectThread(thread.id)}
                  className={`w-full text-left p-3 flex items-center gap-3 hover:bg-accent/50 transition-colors border-b border-border/50 ${
                    thread.id === selectedThreadId ? "bg-accent" : ""
                  }`}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {thread.threadType === "group" || thread.threadType === "channel"
                          ? (thread.title?.charAt(0) || "#").toUpperCase()
                          : getInitials(
                              thread.participants.find(p => p.userId !== user?.id)?.firstName,
                              thread.participants.find(p => p.userId !== user?.id)?.lastName,
                            )
                        }
                      </AvatarFallback>
                    </Avatar>
                    {thread.unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
                        {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm truncate ${thread.unreadCount > 0 ? "font-bold" : "font-medium"}`}>
                        {getThreadDisplayName(thread)}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                        {thread.updatedAt ? formatThreadTime(thread.updatedAt) : ""}
                      </span>
                    </div>
                    {thread.lastMessage && (
                      <p className={`text-xs truncate mt-0.5 ${thread.unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {thread.lastMessage.senderName}: {thread.lastMessage.content}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {showConversation && selectedThreadId ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-3 border-b border-border flex items-center gap-3 shrink-0 bg-background">
            {isMobileView && (
              <Button variant="ghost" size="icon" onClick={handleBack}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            {threadLoading ? (
              <Skeleton className="h-5 w-32" />
            ) : threadData?.data?.thread ? (
              <>
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {threadData.data.thread.threadType === "direct"
                      ? getInitials(
                          threadData.data.thread.participants.find(p => p.userId !== user?.id)?.firstName,
                          threadData.data.thread.participants.find(p => p.userId !== user?.id)?.lastName,
                        )
                      : (threadData.data.thread.title?.charAt(0) || "#").toUpperCase()
                    }
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold truncate">
                    {getThreadDetailName(threadData.data.thread)}
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    {threadData.data.thread.participants.length} participant{threadData.data.thread.participants.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-1"
          >
            {threadLoading ? (
              <div className="space-y-4 py-8">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className={`flex gap-2 ${i % 2 === 0 ? "justify-end" : ""}`}>
                    {i % 2 !== 0 && <Skeleton className="h-8 w-8 rounded-full shrink-0" />}
                    <Skeleton className="h-12 w-48 rounded-2xl" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {threadData?.data?.hasMore && (
                  <div className="text-center py-2">
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                      <ChevronUp className="h-3 w-3 mr-1" /> Load older messages
                    </Button>
                  </div>
                )}
                {localMessages.map((msg, idx) => {
                  const isOwn = msg.senderId === user?.id;
                  const isSystem = msg.messageType === "system";
                  const isDeleted = !!msg.deletedAt;
                  const showAvatar = !isOwn && !isSystem &&
                    (idx === 0 || localMessages[idx - 1]?.senderId !== msg.senderId);
                  const showName = showAvatar;
                  const isAdmin = user?.role?.name === "admin" || user?.role?.name === "owner";

                  if (isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center py-1">
                        <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                          {msg.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-2 group ${isOwn ? "justify-end" : "justify-start"} ${showAvatar ? "mt-3" : "mt-0.5"}`}
                    >
                      {!isOwn && (
                        <div className="w-8 shrink-0">
                          {showAvatar && (
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                {getInitials(msg.senderName, msg.senderLastName)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      )}
                      <div className={`max-w-[75%] min-w-0 ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
                        {showName && (
                          <span className="text-[11px] text-muted-foreground mb-0.5 px-1">
                            {msg.senderName}
                          </span>
                        )}
                        {msg.replyTo && (
                          <div className={`text-[11px] px-3 py-1 rounded-t-xl mb-0 border-l-2 border-primary/40 bg-muted/50 max-w-full truncate ${isOwn ? "self-end" : "self-start"}`}>
                            <span className="font-medium">{msg.replyTo.senderName}:</span>{" "}
                            <span className="text-muted-foreground">{msg.replyTo.content}</span>
                          </div>
                        )}
                        <div className="flex items-end gap-1 group/msg">
                          {isOwn && !isDeleted && (
                            <div className="flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={() => {
                                  setEditingMessage(msg);
                                  setEditContent(msg.content);
                                }}
                                className="p-1 rounded hover:bg-muted"
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </button>
                              <button
                                onClick={() => deleteMutation.mutate(msg.id)}
                                className="p-1 rounded hover:bg-muted"
                                title="Delete"
                              >
                                <Trash2 className="h-3 w-3 text-muted-foreground" />
                              </button>
                            </div>
                          )}
                          <div
                            className={`px-3 py-2 rounded-2xl text-sm break-words whitespace-pre-wrap ${
                              isDeleted
                                ? "bg-muted/30 text-muted-foreground italic"
                                : isOwn
                                  ? "bg-primary text-primary-foreground rounded-br-md"
                                  : "bg-muted dark:bg-muted/50 rounded-bl-md"
                            } ${msg.sending ? "opacity-70" : ""}`}
                          >
                            {editingMessage?.id === msg.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  value={editContent}
                                  onChange={(e) => setEditContent(e.target.value)}
                                  className="h-7 text-sm bg-background text-foreground"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      editMutation.mutate({ id: msg.id, content: editContent });
                                    }
                                    if (e.key === "Escape") {
                                      setEditingMessage(null);
                                      setEditContent("");
                                    }
                                  }}
                                />
                                <button onClick={() => editMutation.mutate({ id: msg.id, content: editContent })}>
                                  <Check className="h-4 w-4" />
                                </button>
                                <button onClick={() => { setEditingMessage(null); setEditContent(""); }}>
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              msg.content
                            )}
                            {msg.imageUrl && !isDeleted && (
                              <img src={msg.imageUrl} alt="" className="mt-1 max-w-full rounded-lg max-h-60 object-cover" />
                            )}
                          </div>
                          {!isOwn && !isDeleted && (
                            <div className="flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={() => setReplyTo(msg)}
                                className="p-1 rounded hover:bg-muted"
                                title="Reply"
                              >
                                <Reply className="h-3 w-3 text-muted-foreground" />
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={() => deleteMutation.mutate(msg.id)}
                                  className="p-1 rounded hover:bg-muted"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 px-1 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {formatMessageTime(msg.createdAt)}
                          </span>
                          {msg.editedAt && !isDeleted && (
                            <span className="text-[10px] text-muted-foreground italic">edited</span>
                          )}
                          {msg.sending && (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {typingList.length > 0 && (
            <div className="px-4 py-1 text-xs text-muted-foreground italic">
              {typingList.join(", ")} {typingList.length === 1 ? "is" : "are"} typing...
            </div>
          )}

          {replyTo && (
            <div className="px-4 py-2 bg-muted/30 border-t border-border flex items-center gap-2">
              <Reply className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">{replyTo.senderName}</span>
                <p className="text-xs text-muted-foreground truncate">{replyTo.content}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyTo(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="p-3 border-t border-border bg-background shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={messageInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[40px] max-h-[120px]"
                style={{
                  height: "auto",
                  overflow: messageInput.split("\n").length > 4 ? "auto" : "hidden",
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = Math.min(target.scrollHeight, 120) + "px";
                }}
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-full shrink-0"
                disabled={!messageInput.trim() || sendMutation.isPending}
                onClick={handleSend}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : !isMobileView ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">Select a conversation or start a new one</p>
          </div>
        </div>
      ) : null}

      <NewThreadDialog open={showNewThread} onOpenChange={setShowNewThread} onCreated={handleThreadCreated} />
    </div>
  );
}
