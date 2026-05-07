import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidatePrefix } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageSquare, Send, Plus, ArrowLeft, Loader2, ChevronUp, X, Pencil, Trash2, Check, CheckCheck, Reply,
  Heart, Star, Users, Smile, Sparkles, Shield, Trophy, PartyPopper, Megaphone, ImageIcon,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import NewThreadDialog from "./NewThreadDialog";
import GiveKudoDialog from "@/features/kudos/GiveKudoDialog";

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

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "✅"];

const SHOUTOUT_CATEGORIES = [
  { value: "great_attitude", label: "Great Attitude", emoji: "✌️" },
  { value: "team_player", label: "Team Player", emoji: "🤝" },
  { value: "above_and_beyond", label: "Above & Beyond", emoji: "🚀" },
  { value: "problem_solver", label: "Problem Solver", emoji: "💡" },
  { value: "customer_hero", label: "Customer Hero", emoji: "⭐" },
  { value: "quick_learner", label: "Quick Learner", emoji: "📚" },
  { value: "great_communicator", label: "Great Communicator", emoji: "💬" },
  { value: "reliability", label: "Reliability", emoji: "🛡️" },
];

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
  toEmployeeId?: string | null;
  toEmployeeName?: string | null;
  kudoCategory?: string | null;
  reactions: Array<{ userId: string; emoji: string }>;
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

interface WallItem {
  id: string;
  itemType: "kudo" | "shoutout";
  senderId: string;
  recipientId: string;
  message: string;
  createdAt: string;
  category: string | null;
  emoji: string | null;
  reactions: Array<{ userId: string; emoji: string }>;
  senderName: string;
  recipientName: string;
}

interface TeamMember {
  id: string;
  firstName: string | null;
  lastName: string | null;
  isActive?: boolean;
}

interface InlineRecognitionFormProps {
  type: "kudo" | "shoutout";
  threadId: string;
  onClose: () => void;
  onSent: () => void;
}

function InlineRecognitionForm({ type, threadId, onClose, onSent }: InlineRecognitionFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<TeamMember | null>(null);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState(SHOUTOUT_CATEGORIES[0].value);

  const { data: teamData } = useQuery<TeamMember[]>({
    queryKey: ["/api/users"],
  });

  const team = useMemo(() => {
    const all = (teamData ?? []).filter(u => u.id !== user?.id && u.isActive !== false);
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(u =>
      u.firstName?.toLowerCase().includes(q) || u.lastName?.toLowerCase().includes(q)
    );
  }, [teamData, user, search]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/messages/threads/${threadId}/messages`, {
        content: message.trim(),
        message_type: type,
        to_employee_id: selectedRecipient?.id,
        kudo_category: type === "shoutout" ? category : undefined,
        temp_id: `temp-${Date.now()}`,
      });
    },
    onSuccess: () => {
      onSent();
      toast({ title: type === "kudo" ? "Kudo sent! 💛" : "Shoutout sent! 🎉" });
    },
    onError: () => {
      toast({ title: `Failed to send ${type}`, variant: "destructive" });
    },
  });

  const catInfo = SHOUTOUT_CATEGORIES.find(c => c.value === category) || SHOUTOUT_CATEGORIES[0];

  return (
    <div className="p-3 border-t border-border bg-muted/20 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {type === "kudo"
            ? <Heart className="h-4 w-4 text-pink-500" />
            : <PartyPopper className="h-4 w-4 text-amber-500" />}
          <span className="text-sm font-medium">
            {type === "kudo" ? "Give a Kudo" : "Send a Shoutout"}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Recipient search */}
      <Input
        placeholder="Search recipient..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="h-8 text-sm"
      />

      {/* Team grid (mini) */}
      {!selectedRecipient && (
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {team.slice(0, 20).map((u) => (
            <button
              key={u.id}
              onClick={() => { setSelectedRecipient(u); setSearch(""); }}
              className="flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-border hover:bg-primary/10 transition-colors"
            >
              <Avatar className="h-4 w-4">
                <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                  {getInitials(u.firstName, u.lastName)}
                </AvatarFallback>
              </Avatar>
              {u.firstName}
            </button>
          ))}
        </div>
      )}

      {selectedRecipient && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">To:</span>
          <Badge variant="secondary" className="gap-1 text-xs">
            {selectedRecipient.firstName} {selectedRecipient.lastName}
            <button onClick={() => setSelectedRecipient(null)}>
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        </div>
      )}

      {type === "shoutout" && (
        <div className="flex flex-wrap gap-1">
          {SHOUTOUT_CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                category === c.value
                  ? "bg-amber-100 dark:bg-amber-900/30 border-amber-400 text-amber-700 dark:text-amber-300"
                  : "border-border hover:bg-muted"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      )}

      <Textarea
        placeholder={type === "kudo" ? "What did they do that was awesome?" : "Give them a shoutout..."}
        value={message}
        onChange={e => setMessage(e.target.value.slice(0, 280))}
        className="min-h-[60px] text-sm resize-none"
      />

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          className={`flex-1 ${type === "kudo"
            ? "bg-gradient-to-r from-pink-500 to-amber-500 hover:from-pink-600 hover:to-amber-600 text-white"
            : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"}`}
          disabled={!selectedRecipient || !message.trim() || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
        >
          {sendMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Send
        </Button>
      </div>
    </div>
  );
}

function RecognitionCard({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const isKudo = msg.messageType === "kudo";
  const catInfo = isKudo ? null : SHOUTOUT_CATEGORIES.find(c => c.value === msg.kudoCategory);

  return (
    <div className={`rounded-2xl border p-3 max-w-[280px] ${
      isKudo
        ? "bg-gradient-to-br from-pink-50 to-amber-50 dark:from-pink-950/30 dark:to-amber-950/20 border-pink-200/60 dark:border-pink-800/30"
        : "bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border-amber-200/60 dark:border-amber-800/30"
    }`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {isKudo
          ? <Heart className="h-3.5 w-3.5 text-pink-500 fill-pink-500" />
          : <PartyPopper className="h-3.5 w-3.5 text-amber-500" />}
        <span className="text-xs font-semibold text-foreground/80">
          {isKudo ? "Kudo" : `Shoutout${catInfo ? ` · ${catInfo.emoji} ${catInfo.label}` : ""}`}
        </span>
      </div>
      {msg.toEmployeeName && (
        <p className="text-xs text-muted-foreground mb-1">
          To <span className="font-semibold text-foreground">{msg.toEmployeeName}</span>
        </p>
      )}
      <p className="text-sm leading-snug">"{msg.content}"</p>
    </div>
  );
}

function TeamWall() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [giveKudoOpen, setGiveKudoOpen] = useState(false);
  const [shoutoutOpen, setShoutoutOpen] = useState(false);

  const { data: wallData, isLoading } = useQuery<{ success: boolean; data: WallItem[]; hasMore: boolean }>({
    queryKey: ["/api/messages/wall"],
    refetchInterval: 60000,
  });

  const reactMutation = useMutation({
    mutationFn: async ({ id, type, emoji }: { id: string; type: "kudo" | "shoutout"; emoji: string }) => {
      if (type === "kudo") {
        return await apiRequest("POST", `/api/kudos/${id}/react`, { emoji });
      }
      return await apiRequest("POST", `/api/shoutouts/${id}/react`, { emoji });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/wall"] });
    },
  });

  const items = wallData?.data || [];

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-bold">Team Wall</h2>
          <p className="text-xs text-muted-foreground">Kudos & Shoutouts</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setGiveKudoOpen(true)}
            className="gap-1 text-xs h-8"
          >
            <Heart className="h-3 w-3 text-pink-500" /> Kudo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShoutoutOpen(true)}
            className="gap-1 text-xs h-8"
          >
            <PartyPopper className="h-3 w-3 text-amber-500" /> Shoutout
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="p-4 rounded-2xl border border-border">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-5xl mb-3">💛</div>
            <h3 className="text-base font-medium mb-1">No recognition yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Be the first to recognize a teammate!</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setGiveKudoOpen(true)}>
              <Heart className="h-4 w-4 text-pink-500" /> Give the first kudo
            </Button>
          </div>
        ) : (
          <div className="space-y-3 max-w-xl mx-auto">
            {items.map(item => (
              <WallCard
                key={item.id}
                item={item}
                currentUserId={user?.id || ""}
                onReact={(emoji) => reactMutation.mutate({ id: item.id, type: item.itemType, emoji })}
              />
            ))}
          </div>
        )}
      </div>

      <GiveKudoDialog open={giveKudoOpen} onOpenChange={setGiveKudoOpen} />
      <ShoutoutDialog open={shoutoutOpen} onOpenChange={setShoutoutOpen} />
    </div>
  );
}

function WallCard({ item, currentUserId, onReact }: {
  item: WallItem;
  currentUserId: string;
  onReact: (emoji: string) => void;
}) {
  const isKudo = item.itemType === "kudo";
  const catInfo = isKudo ? null : SHOUTOUT_CATEGORIES.find(c => c.value === item.category);

  // Aggregate reactions
  const reactionMap = new Map<string, { count: number; users: string[] }>();
  for (const r of (item.reactions || [])) {
    const existing = reactionMap.get(r.emoji) || { count: 0, users: [] };
    existing.count++;
    existing.users.push(r.userId);
    reactionMap.set(r.emoji, existing);
  }

  return (
    <div className={`group relative rounded-2xl border p-4 transition-all hover:shadow-sm ${
      isKudo
        ? "bg-gradient-to-br from-background to-pink-50/30 dark:to-pink-950/10 border-border/60 hover:border-pink-200 dark:hover:border-pink-800/40"
        : "bg-gradient-to-br from-background to-amber-50/30 dark:to-amber-950/10 border-border/60 hover:border-amber-200 dark:hover:border-amber-800/40"
    }`}>
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className={`h-10 w-10 ring-2 ${isKudo ? "ring-pink-200/50 dark:ring-pink-800/30" : "ring-amber-200/50 dark:ring-amber-800/30"}`}>
            <AvatarFallback className={`text-xs font-bold ${
              isKudo
                ? "bg-pink-100 dark:bg-pink-900/40 text-pink-600 dark:text-pink-400"
                : "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
            }`}>
              {item.senderName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className={`absolute -bottom-0.5 -right-0.5 rounded-full p-0.5 ${isKudo ? "bg-pink-400" : "bg-amber-400"}`}>
            {isKudo
              ? <Heart className="h-2.5 w-2.5 text-white fill-white" />
              : <PartyPopper className="h-2.5 w-2.5 text-white" />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-x-1 text-sm mb-0.5">
            <span className="font-semibold">{item.senderName}</span>
            <span className="text-muted-foreground">{isKudo ? "gave a kudo to" : "shouted out"}</span>
            <span className={`font-semibold ${isKudo ? "text-pink-600 dark:text-pink-400" : "text-amber-600 dark:text-amber-400"}`}>
              {item.recipientName}
            </span>
          </div>
          {catInfo && (
            <Badge variant="secondary" className="text-[10px] mb-1.5 px-1.5 py-0">
              {catInfo.emoji} {catInfo.label}
            </Badge>
          )}
          <p className="text-sm leading-relaxed text-foreground/90">"{item.message}"</p>
          <p className="text-[11px] text-muted-foreground mt-1.5">{timeAgo(item.createdAt)}</p>

          {/* Reactions */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {Array.from(reactionMap.entries()).map(([emoji, { count, users }]) => (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                  users.includes(currentUserId)
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-muted/50 border-border hover:bg-muted"
                }`}
              >
                {emoji} <span>{count}</span>
              </button>
            ))}
            <Popover>
                <PopoverTrigger asChild>
                  <button className="p-1 rounded-full border border-transparent hover:border-border hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
                    <Smile className="h-3 w-3 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" side="top">
                  <div className="flex gap-1">
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} onClick={() => onReact(e)} className="text-lg hover:scale-125 transition-transform">
                        {e}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShoutoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<TeamMember | null>(null);
  const [category, setCategory] = useState(SHOUTOUT_CATEGORIES[0].value);
  const [message, setMessage] = useState("");

  const { data: teamData } = useQuery<TeamMember[]>({ queryKey: ["/api/users"], enabled: open });

  const team = useMemo(() => {
    const all = (teamData ?? []).filter(u => u.id !== user?.id && u.isActive !== false);
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(u =>
      u.firstName?.toLowerCase().includes(q) || u.lastName?.toLowerCase().includes(q)
    );
  }, [teamData, user, search]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const catInfo = SHOUTOUT_CATEGORIES.find(c => c.value === category)!;
      return await apiRequest("POST", "/api/shoutouts", {
        recipientId: selectedRecipient?.id,
        category,
        message: message.trim(),
        emoji: catInfo.emoji,
      });
    },
    onSuccess: () => {
      onOpenChange(false);
      setSelectedRecipient(null);
      setMessage("");
      setSearch("");
      queryClient.invalidateQueries({ queryKey: ["/api/messages/wall"] });
      toast({ title: "Shoutout sent! 🎉" });
    },
    onError: () => {
      toast({ title: "Failed to send shoutout", variant: "destructive" });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-2xl border shadow-xl p-5 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PartyPopper className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-bold">Send a Shoutout</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <Input
            placeholder="Search recipient..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {!selectedRecipient && (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {team.map((u) => (
                <button
                  key={u.id}
                  onClick={() => { setSelectedRecipient(u); setSearch(""); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-border hover:bg-primary/10 transition-colors"
                >
                  <Avatar className="h-4 w-4">
                    <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                      {getInitials(u.firstName, u.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  {u.firstName} {u.lastName}
                </button>
              ))}
            </div>
          )}

          {selectedRecipient && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">To:</span>
              <Badge variant="secondary" className="gap-1">
                {selectedRecipient.firstName} {selectedRecipient.lastName}
                <button onClick={() => setSelectedRecipient(null)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {SHOUTOUT_CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                  category === c.value
                    ? "bg-amber-100 dark:bg-amber-900/30 border-amber-400 text-amber-700 dark:text-amber-300"
                    : "border-border hover:bg-muted"
                }`}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>

          <Textarea
            placeholder="What did they do that deserves a shoutout?"
            value={message}
            onChange={e => setMessage(e.target.value.slice(0, 280))}
            className="min-h-[80px] resize-none"
          />

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              disabled={!selectedRecipient || !message.trim() || sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
            >
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PartyPopper className="h-4 w-4 mr-1" />}
              Send Shoutout 🎉
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MessagingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { lastMessage: wsMessage } = useWebSocket();
  const [activeTab, setActiveTab] = useState<"chats" | "wall">("chats");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [showNewThread, setShowNewThread] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [inlineRecognition, setInlineRecognition] = useState<"kudo" | "shoutout" | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingSentRef = useRef(0);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    const handler = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Track virtual keyboard height via visualViewport so the composer stays
  // visible above the keyboard on iOS/Android.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardHeight(kbHeight);
      if (kbHeight > 0 && !userScrolledUpRef.current) {
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
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
      // Backend marked this thread read on GET — refresh unread count so badges clear immediately
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    }
  }, [threadData]);

  useEffect(() => {
    if (!wsMessage) return;
    const type = wsMessage.type;
    const data = wsMessage.data as Record<string, unknown> & {
      threadId?: string;
      message?: Message;
      tempId?: string;
      messageId?: string;
      content?: string;
      editedAt?: string;
      userId?: string;
      readAt?: string;
      reactions?: Array<{ userId: string; emoji: string }>;
      userName?: string;
    };

    if (type === "new_message" && data.threadId) {
      if (data.threadId === selectedThreadId && data.message) {
        const incoming = data.message as Message;
        setLocalMessages(prev => {
          if (prev.some(m => m.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
        if (!userScrolledUpRef.current) {
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
        apiRequest("GET", `/api/messages/threads/${selectedThreadId}`).catch(() => {});
      }
      invalidatePrefix("/api/messages/threads");
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    }

    if (type === "message_confirmed" && data.tempId && data.threadId === selectedThreadId && data.message) {
      const confirmed = data.message as Message;
      setLocalMessages(prev => prev.map(m =>
        m.tempId === data.tempId ? { ...confirmed, sending: false } : m
      ));
    }

    if (type === "message_edited" && data.threadId === selectedThreadId) {
      setLocalMessages(prev => prev.map(m =>
        m.id === data.messageId
          ? { ...m, content: (data.content as string | undefined) ?? m.content, editedAt: (data.editedAt as string | undefined) ?? m.editedAt }
          : m
      ));
    }

    if (type === "message_deleted" && data.threadId === selectedThreadId) {
      setLocalMessages(prev => prev.map(m =>
        m.id === data.messageId ? { ...m, content: "[Message deleted]", deletedAt: new Date().toISOString() } : m
      ));
    }

    if (type === "message_reacted" && data.threadId === selectedThreadId) {
      const reactions = (data.reactions as Array<{ userId: string; emoji: string }> | undefined) ?? [];
      setLocalMessages(prev => prev.map(m =>
        m.id === data.messageId ? { ...m, reactions } : m
      ));
    }

    if (type === "thread_created") {
      invalidatePrefix("/api/messages/threads");
    }

    if (type === "typing" && data.threadId === selectedThreadId) {
      const typingUserId = data.userId as string | undefined;
      const typingUserName = data.userName as string | undefined;
      if (typingUserId && typingUserName) {
        setTypingUsers(prev => ({ ...prev, [typingUserId]: typingUserName }));
        setTimeout(() => {
          setTypingUsers(prev => {
            const next = { ...prev };
            delete next[typingUserId];
            return next;
          });
        }, 3000);
      }
    }

    if (type === "thread_read" && data.threadId === selectedThreadId) {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/threads", selectedThreadId] });
    }

    if (type === "kudo_sent" || type === "shoutout_created") {
      queryClient.invalidateQueries({ queryKey: ["/api/messages/wall"] });
    }
  }, [wsMessage, selectedThreadId]);

  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; image_url?: string; reply_to_id?: string; temp_id: string; message_type?: string }) => {
      return await apiRequest("POST", `/api/messages/threads/${selectedThreadId}/messages`, payload);
    },
    onSuccess: () => {
      invalidatePrefix("/api/messages/threads");
    },
    onError: (err, variables) => {
      // Remove the optimistic message bubble
      setLocalMessages(prev => prev.filter(m => m.tempId !== variables.temp_id));

      // Only surface a toast for genuine network failures (no connectivity /
      // timeout / request aborted).  HTTP 4xx / 5xx errors mean the server
      // received the request and responded — they are handled silently so the
      // composer stays usable without alarming the user for transient 5xx
      // issues that the DB-column migration now prevents.
      const isNetworkError =
        err instanceof TypeError ||            // "Failed to fetch" — no connection
        (err instanceof DOMException &&        // Timeout or AbortController signal
          (err.name === "AbortError" || err.name === "TimeoutError"));

      if (isNetworkError) {
        // Capture thread + user at failure time so retry always targets the
        // original thread even if the user navigates away before tapping Retry.
        const retryPayload = { ...variables };
        const retryThreadId = selectedThreadId;
        const retryUser = user;
        toast({
          title: "Message not sent",
          description: "Check your connection and try again.",
          variant: "destructive",
          action: (
            <ToastAction
              altText="Retry"
              onClick={() => {
                if (!retryThreadId || !retryUser) return;
                const retryTempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const retryMsg: Message = {
                  id: retryTempId,
                  threadId: retryThreadId,
                  senderId: retryUser.id,
                  content: retryPayload.content,
                  messageType: retryPayload.message_type || "text",
                  imageUrl: retryPayload.image_url || null,
                  replyToId: retryPayload.reply_to_id || null,
                  editedAt: null,
                  deletedAt: null,
                  createdAt: new Date().toISOString(),
                  senderName: retryUser.firstName || "You",
                  senderLastName: retryUser.lastName || "",
                  reactions: [],
                  replyTo: null,
                  tempId: retryTempId,
                  sending: true,
                };
                setLocalMessages(prev => [...prev, retryMsg]);
                sendMutation.mutate({ ...retryPayload, temp_id: retryTempId });
              }}
            >
              Retry
            </ToastAction>
          ),
        });
      }
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

  const reactMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      const res = await apiRequest("POST", `/api/messages/${messageId}/react`, { emoji });
      return res as { data?: { reactions?: Array<{ userId: string; emoji: string }> } };
    },
    onSuccess: (data, vars) => {
      if (data?.data?.reactions) {
        const reactions = data.data.reactions;
        setLocalMessages(prev => prev.map(m =>
          m.id === vars.messageId ? { ...m, reactions } : m
        ));
      }
    },
  });

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/messages/upload-image", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as { url: string };
      setPendingImageUrl(data.url);
    } catch {
      toast({ title: "Image upload failed", variant: "destructive" });
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [toast]);

  const handleSend = useCallback(() => {
    const content = messageInput.trim();
    if ((!content && !pendingImageUrl) || !selectedThreadId || !user) return;

    const finalContent = content || "📷";
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: Message = {
      id: tempId,
      threadId: selectedThreadId,
      senderId: user.id,
      content: finalContent,
      messageType: pendingImageUrl ? "image" : "text",
      imageUrl: pendingImageUrl,
      replyToId: replyTo?.id || null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      senderName: user.firstName || "You",
      senderLastName: user.lastName || "",
      reactions: [],
      replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, senderName: replyTo.senderName } : null,
      tempId,
      sending: true,
    };

    setLocalMessages(prev => [...prev, optimisticMessage]);
    setMessageInput("");
    setReplyTo(null);
    const imgUrl = pendingImageUrl;
    setPendingImageUrl(null);
    userScrolledUpRef.current = false;
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    sendMutation.mutate({
      content: finalContent,
      image_url: imgUrl ?? undefined,
      message_type: imgUrl ? "image" : "text",
      reply_to_id: replyTo?.id,
      temp_id: tempId,
    });
  }, [messageInput, pendingImageUrl, selectedThreadId, user, replyTo, sendMutation]);

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
    setInlineRecognition(null);
    userScrolledUpRef.current = false;
  };

  const handleBack = () => {
    setSelectedThreadId(null);
    setReplyTo(null);
    setEditingMessage(null);
    setInlineRecognition(null);
    invalidatePrefix("/api/messages");
  };

  const handleThreadCreated = (threadId: string) => {
    setShowNewThread(false);
    handleSelectThread(threadId);
    invalidatePrefix("/api/messages");
  };

  // Compute read receipts: returns true if all non-sender participants have read after this message
  const isReadByAll = useCallback((msg: Message) => {
    const participants = threadData?.data?.thread?.participants || [];
    const nonSenders = participants.filter(p => p.userId !== msg.senderId);
    if (nonSenders.length === 0) return false;
    return nonSenders.every(p =>
      p.lastReadAt && new Date(p.lastReadAt) >= new Date(msg.createdAt)
    );
  }, [threadData]);

  return (
    <div className="h-page-chat flex flex-col bg-background overflow-hidden" style={{ overscrollBehavior: "none", paddingBottom: keyboardHeight > 0 ? `${keyboardHeight}px` : undefined }}>
      {/* Top tabs — Tabs root is the flex-1 column so TabsContent panels get bounded height */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "chats" | "wall")} className="flex-1 flex flex-col min-h-0">
        <div className="border-b border-border shrink-0">
          <div className="flex items-center px-4 pt-3 pb-0 gap-4">
            <h1 className="text-lg font-bold mr-2">Messages</h1>
            <TabsList className="h-8">
              <TabsTrigger value="chats" className="text-xs h-7 px-3 gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Chats
              </TabsTrigger>
              <TabsTrigger value="wall" className="text-xs h-7 px-3 gap-1.5">
                <Heart className="h-3.5 w-3.5" /> Team Wall
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

          <TabsContent value="chats" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <div className="flex h-full overflow-hidden">
              {/* Thread list */}
              {showThreadList && (
                <div className={`${isMobileView ? "w-full" : "w-80 border-r border-border"} flex flex-col`}>
                  <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
                    <span className="text-sm font-semibold text-muted-foreground">Conversations</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNewThread(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> New
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
                                {thread.lastMessage.messageType === "kudo" ? "💛 Gave a kudo" :
                                 thread.lastMessage.messageType === "shoutout" ? "🎉 Sent a shoutout" :
                                 `${thread.lastMessage.senderName}: ${thread.lastMessage.content}`}
                              </p>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Chat window */}
              {showConversation && selectedThreadId ? (
                <div className="flex-1 flex flex-col min-w-0">
                  {/* Chat header */}
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

                  {/* Messages */}
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
                          const isRecognition = msg.messageType === "kudo" || msg.messageType === "shoutout";
                          const showAvatar = !isOwn && !isSystem &&
                            (idx === 0 || localMessages[idx - 1]?.senderId !== msg.senderId);
                          const showName = showAvatar;
                          const isAdmin = user?.role?.name === "admin" || user?.role?.name === "owner";
                          const readByAll = isOwn && !msg.sending && isReadByAll(msg);

                          // Aggregate reactions
                          const reactionMap = new Map<string, { count: number; users: string[] }>();
                          for (const r of (msg.reactions || [])) {
                            const ex = reactionMap.get(r.emoji) || { count: 0, users: [] };
                            ex.count++;
                            ex.users.push(r.userId);
                            reactionMap.set(r.emoji, ex);
                          }

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
                                  {isOwn && !isDeleted && !isRecognition && (
                                    <div className="flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity shrink-0">
                                      <button
                                        onClick={() => { setEditingMessage(msg); setEditContent(msg.content); }}
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

                                  {isRecognition && !isDeleted ? (
                                    <RecognitionCard msg={msg} isOwn={isOwn} />
                                  ) : (
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
                                              if (e.key === "Enter") editMutation.mutate({ id: msg.id, content: editContent });
                                              if (e.key === "Escape") { setEditingMessage(null); setEditContent(""); }
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
                                  )}

                                  {!isOwn && !isDeleted && (
                                    <div className="flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity shrink-0">
                                      {/* Emoji reaction picker */}
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button className="p-1 rounded hover:bg-muted" title="React">
                                            <Smile className="h-3 w-3 text-muted-foreground" />
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-2" side="top">
                                          <div className="flex gap-1">
                                            {EMOJI_OPTIONS.map(e => (
                                              <button
                                                key={e}
                                                onClick={() => reactMutation.mutate({ messageId: msg.id, emoji: e })}
                                                className="text-lg hover:scale-125 transition-transform"
                                              >
                                                {e}
                                              </button>
                                            ))}
                                          </div>
                                        </PopoverContent>
                                      </Popover>
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
                                  {isOwn && !isDeleted && !isRecognition && (
                                    <div className="flex gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity shrink-0">
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button className="p-1 rounded hover:bg-muted" title="React">
                                            <Smile className="h-3 w-3 text-muted-foreground" />
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-2" side="top">
                                          <div className="flex gap-1">
                                            {EMOJI_OPTIONS.map(e => (
                                              <button
                                                key={e}
                                                onClick={() => reactMutation.mutate({ messageId: msg.id, emoji: e })}
                                                className="text-lg hover:scale-125 transition-transform"
                                              >
                                                {e}
                                              </button>
                                            ))}
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    </div>
                                  )}
                                </div>

                                {/* Reactions display */}
                                {reactionMap.size > 0 && (
                                  <div className={`flex flex-wrap gap-1 mt-1 px-1 ${isOwn ? "justify-end" : ""}`}>
                                    {Array.from(reactionMap.entries()).map(([emoji, { count, users }]) => (
                                      <button
                                        key={emoji}
                                        onClick={() => reactMutation.mutate({ messageId: msg.id, emoji })}
                                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                                          users.includes(user?.id || "")
                                            ? "bg-primary/10 border-primary/30 text-primary"
                                            : "bg-muted/60 border-border hover:bg-muted"
                                        }`}
                                      >
                                        {emoji} <span>{count}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}

                                <div className={`flex items-center gap-1 px-1 mt-0.5 ${isOwn ? "justify-end" : ""}`}>
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatMessageTime(msg.createdAt)}
                                  </span>
                                  {msg.editedAt && !isDeleted && (
                                    <span className="text-[10px] text-muted-foreground italic">edited</span>
                                  )}
                                  {msg.sending && (
                                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                  )}
                                  {isOwn && !msg.sending && !isDeleted && (
                                    readByAll
                                      ? <CheckCheck className="h-3 w-3 text-primary" />
                                      : <Check className="h-3 w-3 text-muted-foreground" />
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

                  {/* Inline recognition form */}
                  {inlineRecognition && selectedThreadId && (
                    <InlineRecognitionForm
                      type={inlineRecognition}
                      threadId={selectedThreadId}
                      onClose={() => setInlineRecognition(null)}
                      onSent={() => {
                        setInlineRecognition(null);
                        invalidatePrefix("/api/messages/threads");
                        queryClient.invalidateQueries({ queryKey: ["/api/messages/wall"] });
                      }}
                    />
                  )}

                  {/* Composer */}
                  {!inlineRecognition && (
                    <div
                      className="p-3 border-t border-border bg-background shrink-0"
                      style={{ paddingBottom: `calc(0.75rem + env(safe-area-inset-bottom, 0px))` }}
                    >
                      {/* Image preview strip */}
                      {pendingImageUrl && (
                        <div className="mb-2 relative inline-block">
                          <img src={pendingImageUrl} alt="Attachment preview" className="h-20 rounded-lg object-cover border border-border" />
                          <button
                            onClick={() => setPendingImageUrl(null)}
                            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center"
                            aria-label="Remove image"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-end gap-2">
                        {/* Hidden file input */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                          className="hidden"
                          onChange={handleImageSelect}
                        />

                        {/* Plus action menu */}
                        <Popover open={showPlusMenu} onOpenChange={setShowPlusMenu}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="icon" className="h-10 w-10 rounded-full shrink-0">
                              <Plus className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-48 p-1" side="top" align="start">
                            <button
                              onClick={() => { fileInputRef.current?.click(); setShowPlusMenu(false); }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                            >
                              {isUploadingImage
                                ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                : <ImageIcon className="h-4 w-4 text-blue-500" />}
                              Send an Image
                            </button>
                            <button
                              onClick={() => { setInlineRecognition("kudo"); setShowPlusMenu(false); }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                            >
                              <Heart className="h-4 w-4 text-pink-500" />
                              Give a Kudo
                            </button>
                            <button
                              onClick={() => { setInlineRecognition("shoutout"); setShowPlusMenu(false); }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
                            >
                              <PartyPopper className="h-4 w-4 text-amber-500" />
                              Send a Shoutout
                            </button>
                          </PopoverContent>
                        </Popover>

                        <textarea
                          ref={inputRef}
                          value={messageInput}
                          onChange={handleInputChange}
                          onKeyDown={handleKeyDown}
                          placeholder={pendingImageUrl ? "Add a caption..." : "Type a message..."}
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
                          disabled={(!messageInput.trim() && !pendingImageUrl) || sendMutation.isPending || isUploadingImage}
                          onClick={handleSend}
                        >
                          {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : !isMobileView ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">Select a conversation or start a new one</p>
                  </div>
                </div>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="wall" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <div className="h-full overflow-y-auto">
              <TeamWall />
            </div>
          </TabsContent>
        </Tabs>

      <NewThreadDialog open={showNewThread} onOpenChange={setShowNewThread} onCreated={handleThreadCreated} />
    </div>
  );
}
