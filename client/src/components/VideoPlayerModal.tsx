import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, MessageCircle, X, Send, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Author {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface Comment {
  id: string;
  videoId: string;
  employeeId: string;
  commentText: string;
  createdAt: string;
  author: Author | null;
}

interface VideoDetail {
  id: string;
  title: string;
  description: string | null;
  category: string;
  storageType: string;
  s3Url: string | null;
  youtubeVideoId: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  viewCount: number;
  isFeatured: boolean;
  createdAt: string;
  employeeId: string;
  likeCount: number;
  hasLiked: boolean;
  author: Author | null;
  comments: Comment[];
}

function getAuthorName(author: Author | null): string {
  if (!author) return "Unknown";
  return `${author.firstName || ""} ${author.lastName || ""}`.trim() || "Unknown";
}

function getInitials(author: Author | null): string {
  if (!author) return "?";
  return `${(author.firstName || "")[0] || ""}${(author.lastName || "")[0] || ""}`.toUpperCase() || "?";
}

export default function VideoPlayerModal({
  videoId,
  onClose,
}: {
  videoId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const commentInputRef = useRef<HTMLInputElement>(null);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  const { data: video, isLoading } = useQuery<VideoDetail>({
    queryKey: ["/api/videos", videoId],
    queryFn: async () => {
      const res = await fetch(`/api/videos/${videoId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load video");
      return res.json();
    },
  });

  const likeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/videos/${videoId}/like`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos", videoId] });
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", `/api/videos/${videoId}/comments`, { commentText: text });
      return res.json();
    },
    onSuccess: () => {
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["/api/videos", videoId] });
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
    },
  });

  const handleSubmitComment = () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    commentMutation.mutate(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="bg-background w-full max-w-2xl max-h-[90vh] rounded-t-2xl md:rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b shrink-0">
          <h2 className="text-sm font-bold truncate flex-1">{video?.title || "Loading..."}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 space-y-4">
              <Skeleton className="aspect-video rounded-xl" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : video ? (
            <div>
              <div className="bg-black">
                {video.s3Url ? (
                  <video
                    src={video.s3Url}
                    className="w-full aspect-video object-contain"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : video.youtubeVideoId ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${video.youtubeVideoId}?autoplay=1`}
                    className="w-full aspect-video"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center text-white/50">
                    Video unavailable
                  </div>
                )}
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <h3 className="text-base font-bold leading-tight">{video.title}</h3>
                  {video.description && (
                    <p className="text-sm text-muted-foreground mt-1">{video.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {video.author?.profileImageUrl ? (
                      <img src={video.author.profileImageUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      getInitials(video.author)
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{getAuthorName(video.author)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(video.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" /> {video.viewCount} views
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t border-b py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => likeMutation.mutate()}
                    disabled={likeMutation.isPending}
                    className={`flex items-center gap-1.5 ${video.hasLiked ? "text-red-500" : ""}`}
                  >
                    <Heart className={`h-4 w-4 ${video.hasLiked ? "fill-red-500" : ""}`} />
                    {video.likeCount}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => commentInputRef.current?.focus()}
                    className="flex items-center gap-1.5"
                  >
                    <MessageCircle className="h-4 w-4" /> {video.comments.length}
                  </Button>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Comments</h4>
                  {video.comments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No comments yet. Be the first!</p>
                  ) : (
                    <div className="space-y-3 max-h-60 overflow-y-auto">
                      {video.comments.map((c) => (
                        <div key={c.id} className="flex gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {c.author?.profileImageUrl ? (
                              <img src={c.author.profileImageUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                            ) : (
                              getInitials(c.author)
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-semibold">{getAuthorName(c.author)}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="text-xs mt-0.5">{c.commentText}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {video && (
          <div className="p-3 border-t shrink-0 flex gap-2">
            <Input
              ref={commentInputRef}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              maxLength={500}
              onKeyDown={(e) => e.key === "Enter" && handleSubmitComment()}
              className="text-sm"
            />
            <Button
              size="icon"
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || commentMutation.isPending}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
