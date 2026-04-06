import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft, Clock, Users, Search, CheckCircle2, XCircle, Inbox,
  AlertTriangle, ArrowUpCircle, Minus, Loader2,
} from "lucide-react";

interface TeamMember {
  id: string;
  name: string;
}

interface Recommendation {
  id: string;
  meetingId: string;
  description: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  gtdInboxItemId: string | null;
}

interface MeetingSynopsis {
  summary: string;
  keyDecisions: string[];
  discussionPoints: string[];
  openQuestions: string[];
}

interface MeetingDetail {
  id: string;
  title: string;
  status: string;
  date: string;
  createdAt: string;
  durationSeconds: number | null;
  participantIds: string[];
  transcript: string | null;
  synopsis: MeetingSynopsis | null;
  recommendations: Recommendation[];
  teamMembers: TeamMember[];
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function PriorityBadge({ priority }: { priority: string }) {
  const configs: Record<string, { label: string; icon: any; className: string }> = {
    urgent: { label: "Urgent", icon: AlertTriangle, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0" },
    high: { label: "High", icon: ArrowUpCircle, className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-0" },
    normal: { label: "Normal", icon: Minus, className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0" },
    low: { label: "Low", icon: Minus, className: "bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400 border-0" },
  };
  const cfg = configs[priority] || configs.normal;
  const Icon = cfg.icon;
  return (
    <Badge className={`gap-1 text-xs ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function TranscriptTab({ transcript }: { transcript: string | null }) {
  const [search, setSearch] = useState("");

  if (!transcript) {
    return <p className="text-muted-foreground text-sm">No transcript available.</p>;
  }

  const lines = transcript.split("\n");
  const searchLower = search.toLowerCase();

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search transcript..."
          className="pl-9"
        />
      </div>
      <div className="bg-muted/30 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm space-y-1">
        {lines.map((line, i) => {
          const highlighted = search && line.toLowerCase().includes(searchLower);
          return (
            <p
              key={i}
              className={`leading-relaxed ${highlighted ? "bg-yellow-200 dark:bg-yellow-900/40 -mx-1 px-1 rounded" : ""}`}
            >
              {line || "\u00A0"}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function SynopsisSection({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground">
            <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SynopsisTab({ synopsis }: { synopsis: MeetingSynopsis | null }) {
  if (!synopsis) {
    return <p className="text-muted-foreground text-sm">No synopsis available.</p>;
  }

  return (
    <div className="space-y-5">
      {synopsis.summary && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-2">Summary</h3>
          <p className="text-sm text-foreground leading-relaxed">{synopsis.summary}</p>
        </div>
      )}
      <SynopsisSection title="Key Decisions" items={synopsis.keyDecisions} />
      <SynopsisSection title="Discussion Points" items={synopsis.discussionPoints} />
      <SynopsisSection title="Open Questions" items={synopsis.openQuestions} />
    </div>
  );
}

function RecommendationCard({
  rec,
  teamMembers,
  meetingId,
}: {
  rec: Recommendation;
  teamMembers: TeamMember[];
  meetingId: string;
}) {
  const { toast } = useToast();
  const [assigneeId, setAssigneeId] = useState(rec.assigneeId || "");

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/meetings/${meetingId}/recommendations/${rec.id}/accept`, {
        assigneeId: assigneeId || null,
      });
      if (!res.ok) throw new Error("Failed to accept recommendation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", meetingId] });
      toast({ title: "Added to GTD Inbox", description: "The task has been added to the GTD inbox." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/meetings/${meetingId}/recommendations/${rec.id}/reject`, {});
      if (!res.ok) throw new Error("Failed to reject recommendation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings", meetingId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isAccepted = rec.status === "accepted";
  const isRejected = rec.status === "rejected";
  const isPending = rec.status === "pending";

  return (
    <Card className={`transition-all ${isRejected ? "opacity-50" : ""}`}>
      <CardContent className="p-4">
        <div className={`${isRejected ? "line-through text-muted-foreground" : ""}`}>
          <p className="text-sm font-medium text-foreground mb-2">{rec.description}</p>

          <div className="flex items-center gap-2 mb-3">
            <PriorityBadge priority={rec.priority} />
            {isAccepted && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 gap-1">
                <Inbox className="h-3 w-3" /> In GTD Inbox
                {rec.assigneeName && ` — ${rec.assigneeName}`}
              </Badge>
            )}
          </div>
        </div>

        {isPending && (
          <div className="flex items-center gap-2 mt-3">
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue placeholder="Assign to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned (me)</SelectItem>
                {teamMembers.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending || rejectMutation.isPending}
              className="gap-1 h-8 bg-green-600 hover:bg-green-700 text-white"
            >
              {acceptMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Accept
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => rejectMutation.mutate()}
              disabled={acceptMutation.isPending || rejectMutation.isPending}
              className="gap-1 h-8 text-destructive hover:text-destructive"
            >
              {rejectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Reject
            </Button>
          </div>
        )}

        {isRejected && (
          <p className="text-xs text-muted-foreground mt-2">Rejected</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function MeetingDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useQuery<{ success: boolean; data: MeetingDetail }>({
    queryKey: ["/api/meetings", id],
  });

  const meeting = data?.data;

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Meeting not found or failed to load.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/meetings")}>
              Back to Meetings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pendingCount = meeting.recommendations.filter(r => r.status === "pending").length;
  const acceptedCount = meeting.recommendations.filter(r => r.status === "accepted").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate("/meetings")}
            className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground truncate">{meeting.title}</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
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
                    {meeting.participantIds.length} participant{meeting.participantIds.length !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <Tabs defaultValue="synopsis" className="mt-4">
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="synopsis">Synopsis</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="tasks" className="relative">
              Tasks
              {pendingCount > 0 && (
                <span className="ml-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-4 min-w-[16px] px-1 inline-flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="synopsis">
            <Card>
              <CardContent className="p-4">
                <SynopsisTab synopsis={meeting.synopsis} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transcript">
            <Card>
              <CardContent className="p-4">
                <TranscriptTab transcript={meeting.transcript} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tasks">
            <div className="space-y-4">
              {meeting.recommendations.length === 0 && (
                <Card>
                  <CardContent className="p-8 text-center">
                    <p className="text-muted-foreground text-sm">No task recommendations found.</p>
                  </CardContent>
                </Card>
              )}

              {acceptedCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  {acceptedCount} task{acceptedCount !== 1 ? "s" : ""} added to GTD Inbox
                </div>
              )}

              {meeting.recommendations.map(rec => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  teamMembers={meeting.teamMembers}
                  meetingId={meeting.id}
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
