import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Minus, Edit3, ArrowUpDown, FileText, Scissors,
  Wrench, ChevronDown, ChevronUp, CheckCircle2, X, Clock,
  AlertTriangle, Lightbulb, MessageSquareQuote, BarChart3,
} from "lucide-react";

interface Proposal {
  id: string;
  storeId: string;
  sopTemplateId: string;
  sourceType: string;
  sourceIds: string[];
  proposalType: string;
  title: string;
  description: string;
  aiRationale: string | null;
  proposedChanges: any;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  sopTitle: string | null;
  sopCategory: string | null;
}

interface Stats {
  pendingCount: number;
  affectedSOPs: number;
}

const PROPOSAL_TYPE_CONFIG: Record<string, { icon: typeof Plus; label: string; color: string }> = {
  add_step: { icon: Plus, label: "Add Step", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  remove_step: { icon: Minus, label: "Remove Step", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  modify_step: { icon: Edit3, label: "Modify Step", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  reorder_steps: { icon: ArrowUpDown, label: "Reorder", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  update_description: { icon: FileText, label: "Update Desc", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
  split_step: { icon: Scissors, label: "Split Step", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  general: { icon: Wrench, label: "General", color: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
};

function ProposalCard({ proposal, onReview, onApproveAndEdit, canReview }: { proposal: Proposal; onReview: (id: string, status: "approved" | "rejected", notes?: string) => void; onApproveAndEdit: (id: string, templateId: string, notes?: string) => void; canReview: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [, navigate] = useLocation();
  const config = PROPOSAL_TYPE_CONFIG[proposal.proposalType] || PROPOSAL_TYPE_CONFIG.general;
  const Icon = config.icon;

  return (
    <Card className="overflow-hidden">
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-start gap-2">
          <Badge className={`text-[10px] px-1.5 py-0 gap-1 shrink-0 ${config.color}`}>
            <Icon className="h-3 w-3" /> {config.label}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-tight">{proposal.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{proposal.description}</p>
          </div>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <Lightbulb className="h-3 w-3" />
          Why this is suggested
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="space-y-2 bg-muted/50 rounded-lg p-2.5">
            {proposal.aiRationale && (
              <div className="flex gap-2 text-xs">
                <BarChart3 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-muted-foreground">{proposal.aiRationale}</p>
              </div>
            )}

            {proposal.sourceType === "what_bugged_you" || proposal.sourceType === "ai_suggestion" ? (
              <div className="flex gap-2 text-xs">
                <MessageSquareQuote className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-muted-foreground italic">
                  Based on employee process feedback (anonymized)
                </p>
              </div>
            ) : null}

            {proposal.sourceType === "sop_insight" || proposal.sourceType === "ai_suggestion" ? (
              <div className="flex gap-2 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-muted-foreground">
                  Supported by SOP analytics insights
                </p>
              </div>
            ) : null}
          </div>
        )}

        {proposal.status === "pending" && canReview && (
          <div className="space-y-2 pt-1">
            <Textarea
              placeholder="Review notes (optional)..."
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="text-xs min-h-[40px] resize-none"
              rows={1}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 gap-1 text-xs"
                onClick={() => onApproveAndEdit(proposal.id, proposal.sopTemplateId, reviewNotes)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve & Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                onClick={() => onReview(proposal.id, "rejected", reviewNotes)}
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </div>
        )}
        {proposal.status === "pending" && !canReview && (
          <p className="text-xs text-muted-foreground pt-1">Only admins and owners can approve or reject suggestions.</p>
        )}

        {proposal.status === "approved" && (
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approved
            <Button size="sm" variant="link" className="text-xs p-0 h-auto" onClick={() => navigate(`/sops/${proposal.sopTemplateId}/edit`)}>
              Edit SOP →
            </Button>
          </div>
        )}

        {proposal.status === "rejected" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Rejected
            {proposal.reviewNotes && <span>— {proposal.reviewNotes}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SOPRevisions() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdminOrOwner = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/sops/revisions/stats"],
    staleTime: 60000,
  });

  const { data: proposals, isLoading } = useQuery<Proposal[]>({
    queryKey: ["/api/sops/revisions", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/sops/revisions?status=${statusFilter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load proposals");
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: "approved" | "rejected"; notes?: string }) => {
      await apiRequest("PUT", `/api/sops/revisions/${id}`, {
        status,
        review_notes: notes || undefined,
      });
      return { status };
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sops/revisions", statusFilter] });
      queryClient.invalidateQueries({ queryKey: ["/api/sops/revisions/stats"] });
      toast({
        title: vars.status === "approved" ? "Proposal approved" : "Proposal rejected",
        description: vars.status === "approved" ? "Open the SOP editor to make the changes." : "The proposal has been dismissed.",
      });
    },
    onError: () => {
      toast({
        title: "Failed to review proposal",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const grouped = (proposals || []).reduce<Record<string, Proposal[]>>((acc, p) => {
    const key = p.sopTemplateId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 pt-4 pb-3 border-b">
        {stats && stats.pendingCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {stats.pendingCount} pending across {stats.affectedSOPs} SOP{stats.affectedSOPs !== 1 ? "s" : ""}
          </p>
        )}

        <div className="flex gap-1.5 mt-3">
          {["pending", "approved", "rejected"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              className="text-xs capitalize"
              onClick={() => setStatusFilter(s)}
            >
              {s}
              {s === "pending" && stats?.pendingCount ? (
                <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0">{stats.pendingCount}</Badge>
              ) : null}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-6">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="text-sm font-medium">No {statusFilter} proposals</p>
            <p className="text-xs text-muted-foreground mt-1">
              {statusFilter === "pending"
                ? "All your SOPs are running smoothly."
                : `No ${statusFilter} proposals to show.`}
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([templateId, templateProposals]) => (
            <div key={templateId} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{templateProposals[0]?.sopTitle || "Unknown SOP"}</h2>
                <Badge variant="secondary" className="text-[10px]">
                  {templateProposals.length} suggestion{templateProposals.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              {templateProposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  canReview={isAdminOrOwner}
                  onReview={(id, status, notes) =>
                    reviewMutation.mutate({ id, status, notes })
                  }
                  onApproveAndEdit={(id, templateId, notes) => {
                    reviewMutation.mutate(
                      { id, status: "approved", notes },
                      { onSuccess: () => navigate(`/sops/${templateId}/edit`) }
                    );
                  }}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
