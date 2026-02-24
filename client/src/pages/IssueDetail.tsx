import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { apiRequest } from '@/lib/queryClient';
import {
  ArrowLeft, Clock, CheckCircle2, Loader2, Send, PartyPopper, ChevronRight,
  Wrench, RefreshCw, Users, Warehouse, Package, ShieldAlert,
  GraduationCap, HelpCircle, ExternalLink, UserCircle, MessageSquare
} from 'lucide-react';

const CATEGORY_CONFIG: Record<string, { icon: typeof Wrench; label: string; color: string }> = {
  equipment: { icon: Wrench, label: 'Equipment', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  process: { icon: RefreshCw, label: 'Process', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  customer_experience: { icon: Users, label: 'Customer', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  workspace: { icon: Warehouse, label: 'Workspace', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  inventory: { icon: Package, label: 'Inventory', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  safety: { icon: ShieldAlert, label: 'Safety', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  training: { icon: GraduationCap, label: 'Training', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  other: { icon: HelpCircle, label: 'Other', color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500',
  urgent: 'bg-red-600 animate-pulse',
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  waiting: { label: 'Waiting', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  resolved: { label: 'Resolved', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  closed: { label: 'Closed', color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'resolved'],
  in_progress: ['waiting', 'resolved'],
  waiting: ['in_progress', 'resolved'],
  resolved: ['closed', 'open'],
  closed: [],
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  commentText: string;
  createdAt: string;
}

interface IssueData {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  photoUrl: string | null;
  reportedBy: string;
  reporterName: string;
  reporterImage: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  resolvedBy: string | null;
  resolverName: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  relatedSop: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
}

export default function IssueDetail() {
  const [, params] = useRoute('/issues/:id');
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { lastMessage } = useWebSocket();
  const id = params?.id ?? '';

  const [commentText, setCommentText] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [showResolutionInput, setShowResolutionInput] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const isManager = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  useEffect(() => {
    if (!lastMessage) return;
    if (
      (lastMessage.type === 'issue_updated' && (lastMessage.data as any)?.issue?.id === id) ||
      (lastMessage.type === 'issue_comment_added' && (lastMessage.data as any)?.issueId === id)
    ) {
      qc.invalidateQueries({ queryKey: ['/api/issues', id] });
    }
  }, [lastMessage, id, qc]);

  const { data, isLoading, error } = useQuery<{ success: boolean; data: IssueData }>({
    queryKey: ['/api/issues', id],
    enabled: !!id,
  });

  const issue = data?.data;

  const { data: teamData } = useQuery<any[]>({
    queryKey: ['/api/users'],
    enabled: isManager,
  });
  const teamUsers = teamData ?? [];

  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return await apiRequest('PUT', `/api/issues/${id}`, payload);
    },
    onSuccess: async (res) => {
      const result = await res.json();
      qc.invalidateQueries({ queryKey: ['/api/issues', id] });
      qc.invalidateQueries({ queryKey: ['/api/issues'] });

      if ((result.data as any)?.status === 'resolved') {
        setShowResolved(true);
        setTimeout(() => setShowResolved(false), 4000);
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update issue', variant: 'destructive' });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', `/api/issues/${id}/comments`, {
        commentText: commentText.trim(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/issues', id] });
      setCommentText('');
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add comment', variant: 'destructive' });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === 'resolved' && !showResolutionInput) {
      setShowResolutionInput(true);
      return;
    }
    updateMutation.mutate({
      status: newStatus,
      resolutionNotes: newStatus === 'resolved' ? resolutionNotes.trim() || undefined : undefined,
    });
    setShowResolutionInput(false);
    setResolutionNotes('');
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="p-4">
        <Button variant="ghost" onClick={() => navigate('/issues')} className="gap-2 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="text-muted-foreground">Issue not found.</p>
      </div>
    );
  }

  const catConfig = CATEGORY_CONFIG[issue.category] || CATEGORY_CONFIG.other;
  const CatIcon = catConfig.icon;
  const statusConfig = STATUS_CONFIG[issue.status] || STATUS_CONFIG.open;
  const nextStatuses = STATUS_TRANSITIONS[issue.status] || [];

  return (
    <div className="h-full flex flex-col bg-background">
      {showResolved && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 animate-in fade-in duration-300">
          <div className="text-center space-y-3 animate-in zoom-in-95 duration-300">
            <PartyPopper className="h-16 w-16 text-green-500 mx-auto animate-bounce" />
            <h2 className="text-xl font-bold">Issue Resolved!</h2>
            <p className="text-muted-foreground">Thanks for keeping things running smooth.</p>
          </div>
        </div>
      )}

      <div className="px-4 pt-4 pb-3 border-b flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/issues')} className="shrink-0 mt-0.5">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-tight">{issue.title}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`w-2.5 h-2.5 rounded-full ${PRIORITY_COLORS[issue.priority]}`} />
            <span className="text-xs text-muted-foreground capitalize">{issue.priority}</span>
            <Badge variant="secondary" className={`text-[10px] gap-1 px-1.5 py-0 ${catConfig.color}`}>
              <CatIcon className="h-3 w-3" />
              {catConfig.label}
            </Badge>
            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusConfig.color}`}>
              {statusConfig.label}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Reported by</p>
            <p className="text-sm font-medium mt-0.5">{issue.reporterName}</p>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock className="h-2.5 w-2.5" /> {timeAgo(issue.createdAt)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Assigned to</p>
            {isManager ? (
              <Select
                value={issue.assignedTo || 'unassigned'}
                onValueChange={(val) => updateMutation.mutate({ assignedTo: val === 'unassigned' ? null : val })}
              >
                <SelectTrigger className="h-8 text-sm mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamUsers.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm font-medium mt-0.5">{issue.assigneeName || 'Unassigned'}</p>
            )}
          </div>
        </div>

        {issue.description && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Description</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{issue.description}</p>
          </div>
        )}

        {issue.photoUrl && (
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Photo</p>
            <img
              src={issue.photoUrl}
              alt="Issue photo"
              className="rounded-lg border max-h-48 w-full object-cover"
            />
          </div>
        )}

        {issue.relatedSop && (
          <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 cursor-pointer"
                onClick={() => navigate(`/sops/${issue.relatedSop!.id}`)}>
            <CardContent className="py-2.5 px-3 flex items-center gap-2">
              <ExternalLink className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-blue-600 dark:text-blue-400 uppercase tracking-wider">Related Procedure</p>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300 truncate">{issue.relatedSop.title}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-blue-400" />
            </CardContent>
          </Card>
        )}

        {issue.resolvedAt && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <p className="text-sm font-medium text-green-700 dark:text-green-300">Resolved</p>
            </div>
            <p className="text-xs text-muted-foreground">
              by {issue.resolverName} &middot; {timeAgo(issue.resolvedAt)}
            </p>
            {issue.resolutionNotes && (
              <p className="text-sm mt-1.5">{issue.resolutionNotes}</p>
            )}
          </div>
        )}

        {(isManager || issue.reportedBy === user?.id) && nextStatuses.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Actions</p>
            <div className="flex gap-2 flex-wrap">
              {nextStatuses.map(ns => {
                const nsConfig = STATUS_CONFIG[ns];
                return (
                  <Button
                    key={ns}
                    variant="outline"
                    size="sm"
                    className="min-h-[36px] gap-1.5"
                    onClick={() => handleStatusChange(ns)}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {nsConfig.label}
                  </Button>
                );
              })}
            </div>

            {showResolutionInput && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <Textarea
                  placeholder="How was this resolved? (optional)"
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  className="min-h-[60px] text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setShowResolutionInput(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    onClick={() => handleStatusChange('resolved')}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                    Resolve
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <Separator />

        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4" />
            Comments
            {issue.comments.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{issue.comments.length}</Badge>
            )}
          </h3>

          {issue.comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet</p>
          )}

          {issue.comments.map(comment => (
            <div key={comment.id} className="flex gap-2.5">
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 overflow-hidden">
                {comment.authorImage ? (
                  <img src={comment.authorImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="text-xs font-medium">{comment.authorName}</p>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                </div>
                <p className="text-sm mt-0.5 whitespace-pre-wrap">{comment.commentText}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-shrink-0 border-t bg-card px-4 py-3">
        <div className="flex gap-2">
          <Textarea
            placeholder="Add a comment..."
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            className="min-h-[40px] max-h-[80px] text-sm flex-1"
            rows={1}
          />
          <Button
            size="sm"
            className="min-h-[40px] min-w-[40px] p-0"
            disabled={!commentText.trim() || commentMutation.isPending}
            onClick={() => commentMutation.mutate()}
          >
            {commentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
