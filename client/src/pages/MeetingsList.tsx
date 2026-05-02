import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Mic, Clock, Users, CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface MeetingRow {
  id: string;
  title: string;
  status: string;
  date: string;
  createdAt: string;
  durationSeconds: number | null;
  participantIds: string[] | null;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 gap-1">
        <CheckCircle className="h-3 w-3" /> Ready
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 gap-1">
        <AlertCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  if (status === "recording") {
    return (
      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 gap-1">
        <Mic className="h-3 w-3 animate-pulse" /> Recording
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-0 gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Processing
    </Badge>
  );
}

export default function MeetingsList() {
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useQuery<{ success: boolean; data: MeetingRow[] }>({
    queryKey: ["/api/meetings"],
    refetchInterval: (query) => {
      const rows = query.state.data?.data || [];
      const hasProcessing = rows.some(m => m.status === "processing");
      return hasProcessing ? 5000 : false;
    },
  });

  const meetings = data?.data || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Meetings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Record and review AI-powered meeting summaries</p>
          </div>
          <Button onClick={() => navigate("/meetings/new")} className="gap-2">
            <Plus className="h-4 w-4" /> New Meeting
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-2/3 mb-2" />
                  <Skeleton className="h-4 w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {error && (
          <Card>
            <CardContent className="p-8 text-center">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Failed to load meetings. Please refresh the page.</p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && meetings.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Mic className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">No meetings yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Record your first meeting to get AI-generated transcripts, summaries, and action items.
              </p>
              <Button onClick={() => navigate("/meetings/new")} className="gap-2">
                <Plus className="h-4 w-4" /> Record a Meeting
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && meetings.length > 0 && (
          <div className="space-y-3">
            {meetings.map(meeting => (
              <Card
                key={meeting.id}
                className={`cursor-pointer transition-colors hover:bg-muted/30 ${meeting.status !== "ready" ? "opacity-80" : ""}`}
                onClick={() => {
                  if (meeting.status === "ready" || meeting.status === "failed") {
                    navigate(`/meetings/${meeting.id}`);
                  }
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground truncate">{meeting.title}</h3>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatDate(meeting.date || meeting.createdAt)}</span>
                        {meeting.durationSeconds && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(meeting.durationSeconds)}
                            </span>
                          </>
                        )}
                        {(meeting.participantIds?.length ?? 0) > 0 && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {meeting.participantIds!.length} participant{meeting.participantIds!.length !== 1 ? "s" : ""}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={meeting.status} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
