import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heart, MessageCircle, Eye, Play, Plus, Star, Film, Clock } from "lucide-react";
import VideoRecordDialog from "@/components/VideoRecordDialog";
import VideoPlayerModal from "@/components/VideoPlayerModal";
import { formatDistanceToNow } from "date-fns";

interface Author {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface Video {
  id: string;
  storeId: string;
  employeeId: string;
  title: string;
  description: string | null;
  category: string;
  storageType: string;
  youtubeVideoId: string | null;
  s3Key: string | null;
  s3Url: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  status: string;
  isFeatured: boolean;
  viewCount: number;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  hasLiked: boolean;
  author: Author | null;
}

interface FeedResponse {
  videos: Video[];
  total: number;
}

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "process", label: "Process" },
  { value: "workspace", label: "Workspace" },
  { value: "customer_experience", label: "Customer Experience" },
  { value: "visual_merchandising", label: "Visual Merchandising" },
  { value: "inventory", label: "Inventory" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

const CATEGORY_ICONS: Record<string, string> = {
  process: "fas fa-cogs",
  workspace: "fas fa-store",
  customer_experience: "fas fa-smile",
  visual_merchandising: "fas fa-palette",
  inventory: "fas fa-boxes",
  equipment: "fas fa-tools",
  other: "fas fa-lightbulb",
};

const CATEGORY_COLORS: Record<string, string> = {
  process: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  workspace: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  customer_experience: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  visual_merchandising: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  inventory: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  equipment: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
  other: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

function getAuthorName(author: Author | null): string {
  if (!author) return "Unknown";
  return `${author.firstName || ""} ${author.lastName || ""}`.trim() || "Unknown";
}

function getInitials(author: Author | null): string {
  if (!author) return "?";
  return `${(author.firstName || "")[0] || ""}${(author.lastName || "")[0] || ""}`.toUpperCase() || "?";
}

export default function ImprovementFeed() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();
  const [sortBy, setSortBy] = useState("recent");
  const [category, setCategory] = useState("all");
  const [showRecordDialog, setShowRecordDialog] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(20);

  const queryKey = ["/api/videos", { sort_by: sortBy, category: category === "all" ? undefined : category, limit: String(displayCount) }];

  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("sort_by", sortBy);
      params.set("limit", String(displayCount));
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/videos?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load videos");
      return res.json();
    },
  });

  useEffect(() => {
    if (lastMessage?.type === "new_improvement_video") {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    }
  }, [lastMessage, queryClient]);

  const videos = data?.videos || [];
  const total = data?.total || 0;
  const featured = videos.find((v) => v.isFeatured);

  const likeMutation = useMutation({
    mutationFn: async (videoId: string) => {
      const res = await apiRequest("POST", `/api/videos/${videoId}/like`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    },
  });

  const handleLoadMore = () => setDisplayCount((prev) => prev + 20);

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="bg-gradient-to-br from-orange-500 to-pink-500 text-white p-5 pb-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <Film className="h-5 w-5" /> Improvements
            </h1>
            <p className="text-xs opacity-80 mt-0.5">60-second improvement videos</p>
          </div>
        </div>
      </div>

      {featured && (
        <div className="px-4 -mt-3">
          <Card
            className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow border-2 border-amber-300 dark:border-amber-700"
            onClick={() => setSelectedVideoId(featured.id)}
          >
            <div className="relative">
              <div className="aspect-video bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-950 dark:to-orange-950 flex items-center justify-center">
                {featured.thumbnailUrl ? (
                  <img src={featured.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Play className="h-12 w-12 text-amber-500/40" />
                )}
              </div>
              <div className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Star className="h-3 w-3" /> IMPROVEMENT OF THE WEEK
              </div>
            </div>
            <CardContent className="p-3">
              <h3 className="text-sm font-bold truncate">{featured.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{getAuthorName(featured.author)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="px-4 mt-4 flex gap-2 items-center overflow-x-auto pb-2 scrollbar-hide">
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-8 text-xs w-auto min-w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most Recent</SelectItem>
            <SelectItem value="popular">Most Liked</SelectItem>
            <SelectItem value="featured">Featured</SelectItem>
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 text-xs w-auto min-w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="px-4 mt-3">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="text-center py-16">
            <Film className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-base font-bold mb-1">No improvements yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Be the first to share a 60-second improvement!
            </p>
            <Button onClick={() => setShowRecordDialog(true)} className="rounded-full">
              <Plus className="h-4 w-4 mr-1" /> Record Improvement
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {videos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onSelect={() => setSelectedVideoId(video.id)}
                  onLike={() => likeMutation.mutate(video.id)}
                />
              ))}
            </div>

            {videos.length < total && (
              <div className="text-center mt-6">
                <Button variant="outline" onClick={handleLoadMore} className="rounded-full">
                  Load More
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => setShowRecordDialog(true)}
        className="fixed bottom-24 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 text-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>

      {showRecordDialog && (
        <VideoRecordDialog
          open={showRecordDialog}
          onOpenChange={setShowRecordDialog}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
          }}
        />
      )}

      {selectedVideoId && (
        <VideoPlayerModal
          videoId={selectedVideoId}
          onClose={() => setSelectedVideoId(null)}
        />
      )}
    </div>
  );
}

function VideoCard({
  video,
  onSelect,
  onLike,
}: {
  video: Video;
  onSelect: () => void;
  onLike: () => void;
}) {
  return (
    <div className="group cursor-pointer" onClick={onSelect}>
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted mb-2">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
            <Play className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        {video.durationSeconds && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-md font-mono">
            {Math.floor(video.durationSeconds / 60)}:{String(video.durationSeconds % 60).padStart(2, "0")}
          </span>
        )}
        {video.isFeatured && (
          <span className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Star className="h-2.5 w-2.5" /> FEATURED
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">
            {video.author?.profileImageUrl ? (
              <img src={video.author.profileImageUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              getInitials(video.author)
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xs font-semibold leading-tight line-clamp-2">{video.title}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {getAuthorName(video.author)}
            </p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
              <span className="flex items-center gap-0.5">
                <Eye className="h-3 w-3" /> {video.viewCount}
              </span>
              <span>·</span>
              <span>{formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground pl-9">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLike();
            }}
            className={`flex items-center gap-1 ${video.hasLiked ? "text-red-500" : ""}`}
          >
            <Heart className={`h-3.5 w-3.5 ${video.hasLiked ? "fill-red-500" : ""}`} />
            {video.likeCount}
          </button>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" /> {video.commentCount}
          </span>
          <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[video.category] || CATEGORY_COLORS.other}`}>
            {video.category.replace("_", " ")}
          </span>
        </div>
      </div>
    </div>
  );
}
