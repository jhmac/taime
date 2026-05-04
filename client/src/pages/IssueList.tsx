import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  AlertTriangle, Clock, ChevronRight, LayoutGrid, List,
  Wrench, RefreshCw, Users, Warehouse, Package, ShieldAlert,
  GraduationCap, HelpCircle, Filter
} from 'lucide-react';
import ReportIssueDialog from '@/components/ReportIssueDialog';

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

const STATUS_COLUMNS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
];

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

interface IssueRow {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  reportedBy: string;
  reporterName: string;
  assigneeName: string | null;
  createdAt: string;
  photoUrl: string | null;
}

export default function IssueList() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { lastMessage } = useWebSocket();
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'issue_created' || lastMessage.type === 'issue_updated') {
      qc.invalidateQueries({ queryKey: ['/api/issues'] });
    }
  }, [lastMessage, qc]);

  const { data, isLoading } = useQuery<{ success: boolean; data: IssueRow[] }>({
    queryKey: ['/api/issues'],
  });

  const allIssues = data?.data ?? [];

  const filtered = allIssues.filter(issue => {
    if (filterCategory !== 'all' && issue.category !== filterCategory) return false;
    if (filterPriority !== 'all' && issue.priority !== filterPriority) return false;
    return true;
  });

  const issuesByStatus = STATUS_COLUMNS.map(col => ({
    ...col,
    issues: filtered.filter(i => i.status === col.value),
  }));

  function IssueCard({ issue }: { issue: IssueRow }) {
    const catConfig = CATEGORY_CONFIG[issue.category] || CATEGORY_CONFIG.other;
    const CatIcon = catConfig.icon;
    return (
      <Card
        className="cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]"
        onClick={() => navigate(`/issues/${issue.id}`)}
      >
        {issue.photoUrl && (
          <div className="rounded-t-lg overflow-hidden">
            <img
              src={issue.photoUrl}
              alt="Issue photo"
              className="w-full h-24 object-cover"
            />
          </div>
        )}
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_COLORS[issue.priority]}`} />
            <p className="text-sm font-medium leading-tight flex-1">{issue.title}</p>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className={`text-[10px] gap-1 px-1.5 py-0 ${catConfig.color}`}>
              <CatIcon className="h-3 w-3" />
              {catConfig.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {timeAgo(issue.createdAt)}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {issue.reporterName}
            {issue.assigneeName && <span> &rarr; {issue.assigneeName}</span>}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 pt-4 pb-2 space-y-3 border-b">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Issues</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setShowFilters(prev => !prev)}
            >
              <Filter className="h-4 w-4" />
            </Button>
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'kanban' | 'list')}>
              <TabsList className="h-8">
                <TabsTrigger value="kanban" className="h-7 px-2"><LayoutGrid className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="list" className="h-7 px-2"><List className="h-3.5 w-3.5" /></TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {showFilters && (
          <div className="flex gap-2 flex-wrap animate-in fade-in slide-in-from-top-2 duration-200">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No issues found</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Tap the button below to report one</p>
          </div>
        )}

        {viewMode === 'kanban' && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {issuesByStatus.map(col => (
              <div key={col.value} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {col.label}
                  </h3>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{col.issues.length}</Badge>
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {col.issues.map(issue => <IssueCard key={issue.id} issue={issue} />)}
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'list' && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map(issue => <IssueCard key={issue.id} issue={issue} />)}
          </div>
        )}
      </div>

      <Button
        size="lg"
        className="fixed bottom-32 right-4 md:bottom-6 md:right-6 rounded-full h-14 w-14 shadow-lg z-40 p-0"
        onClick={() => setShowReportDialog(true)}
      >
        <AlertTriangle className="h-6 w-6" />
      </Button>

      <ReportIssueDialog open={showReportDialog} onOpenChange={setShowReportDialog} />
    </div>
  );
}
