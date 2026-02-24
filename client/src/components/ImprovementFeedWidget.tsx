import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, Play, ArrowRight, Video } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface VideoSummary {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: string;
  author: {
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  } | null;
}

interface FeedResponse {
  videos: VideoSummary[];
  total: number;
}

export default function ImprovementFeedWidget() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: ["/api/videos", { limit: "3", sort_by: "recent" }],
    queryFn: async () => {
      const res = await fetch("/api/videos?limit=3&sort_by=recent", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60000,
  });

  const videos = data?.videos || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-24 rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (videos.length === 0) {
    return (
      <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/improvements")}>
        <CardContent className="p-4 text-center">
          <Video className="h-8 w-8 text-orange-400 mx-auto mb-2" />
          <p className="text-sm font-medium">Got a quick improvement?</p>
          <p className="text-xs text-muted-foreground mt-0.5">Record a 60-second video!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-1.5">
            <Film className="h-4 w-4 text-orange-500" /> Improvements
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate("/improvements")} className="text-xs h-7 px-2">
            See All <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {videos.map((v) => (
            <div
              key={v.id}
              className="shrink-0 w-28 cursor-pointer group"
              onClick={() => navigate("/improvements")}
            >
              <div className="aspect-video rounded-lg overflow-hidden bg-muted mb-1 relative">
                {v.thumbnailUrl ? (
                  <img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-50 to-pink-50 dark:from-orange-950 dark:to-pink-950">
                    <Play className="h-5 w-5 text-orange-400/50" />
                  </div>
                )}
              </div>
              <p className="text-[10px] font-medium line-clamp-2 leading-tight">{v.title}</p>
              <p className="text-[9px] text-muted-foreground">
                {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
