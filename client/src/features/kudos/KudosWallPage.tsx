import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { invalidatePrefix } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, Star, Trophy } from "lucide-react";
import GiveKudoDialog from "./GiveKudoDialog";

function getInitials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

type Filter = "all" | "given" | "received" | "week" | "month";

interface KudoItem {
  id: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  fromName: string;
  toName: string;
  fromImage: string | null;
  toImage: string | null;
  message: string;
  createdAt: string;
}

interface StatsData {
  me: { receivedThisMonth: number; receivedThisWeek: number; givenThisMonth: number; givenThisWeek: number };
  store: { thisWeek: number; thisMonth: number; mostRecognized: string; mostRecognizedCount: number };
}

export default function KudosWallPage() {
  const { user } = useAuth();
  const { lastMessage: wsMessage } = useWebSocket();
  const [filter, setFilter] = useState<Filter>("all");
  const [giveOpen, setGiveOpen] = useState(false);

  useEffect(() => {
    if (wsMessage && (wsMessage as any).type === "kudo_sent") {
      invalidatePrefix("/api/kudos");
    }
  }, [wsMessage]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filter === "given" && user) params.set("from_employee_id", user.id);
    if (filter === "received" && user) params.set("to_employee_id", user.id);
    if (filter === "week") params.set("days", "7");
    if (filter === "month") params.set("days", "30");
    if (filter === "all") params.set("days", "30");
    params.set("limit", "50");
    return params.toString();
  }, [filter, user]);

  const { data: kudosData, isLoading } = useQuery<{ success: boolean; data: KudoItem[]; hasMore: boolean }>({
    queryKey: [`/api/kudos?${queryParams}`],
  });

  const { data: statsData } = useQuery<{ success: boolean; data: StatsData }>({
    queryKey: ["/api/kudos/stats"],
  });

  const kudos = kudosData?.data || [];
  const stats = statsData?.data;

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "given", label: "Given by Me" },
    { key: "received", label: "Received" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-pink-500/10 via-amber-500/10 to-rose-500/10 dark:from-pink-500/5 dark:via-amber-500/5 dark:to-rose-500/5 border-b border-border/50">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                Kudos Wall <span className="text-xl">✨</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">Celebrate your team</p>
            </div>
            <Button
              onClick={() => setGiveOpen(true)}
              className="rounded-full bg-gradient-to-r from-pink-500 to-amber-500 hover:from-pink-600 hover:to-amber-600 text-white shadow-lg shadow-pink-500/20 gap-1.5"
            >
              <Heart className="h-4 w-4" />
              Give a Kudo
            </Button>
          </div>

          {stats && (
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-1.5 bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border/50">
                <Heart className="h-3.5 w-3.5 text-pink-500" />
                <span className="font-medium">{stats.store.thisWeek}</span>
                <span className="text-muted-foreground">this week</span>
              </div>
              <div className="flex items-center gap-1.5 bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border/50">
                <Star className="h-3.5 w-3.5 text-amber-500" />
                <span className="font-medium">{stats.store.thisMonth}</span>
                <span className="text-muted-foreground">this month</span>
              </div>
              {stats.store.mostRecognized !== "No one yet" && (
                <div className="flex items-center gap-1.5 bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border/50">
                  <Trophy className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-muted-foreground">Most recognized:</span>
                  <span className="font-medium">{stats.store.mostRecognized}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 no-scrollbar">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${
                filter === f.key
                  ? "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 font-medium border border-pink-300 dark:border-pink-700"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

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
        ) : kudos.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">💛</div>
            <h3 className="text-lg font-medium mb-1">No kudos yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Be the first to recognize a teammate!</p>
            <Button
              variant="outline"
              className="rounded-full gap-1.5"
              onClick={() => setGiveOpen(true)}
            >
              <Heart className="h-4 w-4 text-pink-500" /> Give the first kudo
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {kudos.map(kudo => (
              <div
                key={kudo.id}
                className="group relative bg-gradient-to-br from-background to-pink-50/30 dark:to-pink-950/10 rounded-2xl border border-border/60 hover:border-pink-200 dark:hover:border-pink-800/40 p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    <Avatar className="h-10 w-10 ring-2 ring-pink-200/50 dark:ring-pink-800/30">
                      <AvatarFallback className="text-xs font-bold bg-pink-100 dark:bg-pink-900/40 text-pink-600 dark:text-pink-400">
                        {getInitials(kudo.fromName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-0.5 -right-0.5 bg-pink-400 rounded-full p-0.5">
                      <Heart className="h-2.5 w-2.5 text-white fill-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-x-1 text-sm">
                      <span className="font-semibold">{kudo.fromName}</span>
                      <span className="text-muted-foreground">gave a kudo to</span>
                      <span className="font-semibold text-pink-600 dark:text-pink-400">{kudo.toName}</span>
                    </div>
                    <p className="text-sm mt-1.5 leading-relaxed text-foreground/90">
                      "{kudo.message}"
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      {timeAgo(kudo.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {kudosData?.hasMore && (
              <div className="text-center py-4">
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <GiveKudoDialog open={giveOpen} onOpenChange={setGiveOpen} />
    </div>
  );
}
