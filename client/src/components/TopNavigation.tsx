import { useState } from 'react';
import { UserButton } from '@clerk/clerk-react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLocation, Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Clock, Target, Award, Users, CheckCheck, Pencil, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/schedules': 'Schedules',
  '/availability': 'Availability',
  '/tasks': 'Tasks & Chores',
  '/communication': 'Messages',
  '/kudos': 'Messages',
  '/messages': 'Messages',
  '/team': 'Team',
  '/payroll': 'Payroll',
  '/hr': 'HR Management',
  '/hr/roles': 'Role Management',
  '/operations': 'Operations',
  '/performance': 'Performance',
  '/payroll-export': 'Payroll Export',
  '/admin': 'Settings',
  '/my-score': 'My Score',
};

interface ScoreNotice {
  id: string;
  userId: string;
  category: string;
  severity: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  attendance: Clock,
  tasks: Target,
  sops: Award,
  engagement: Users,
};

function NoticeIcon({ category, severity }: { category: string; severity: string }) {
  const Icon = CATEGORY_ICONS[category] || Bell;
  const color = severity === 'warning' ? 'text-amber-500' : 'text-primary';
  return <Icon className={`h-4 w-4 ${color} shrink-0`} />;
}

function NotificationsDropdown() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: noticesData } = useQuery<{ notices: ScoreNotice[]; unreadCount: number }>({
    queryKey: ['/api/gamification/notices'],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('PATCH', `/api/gamification/notices/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/gamification/notices'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => apiRequest('PATCH', '/api/gamification/notices/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/gamification/notices'] }),
  });

  const unreadCount = noticesData?.unreadCount ?? 0;
  const recentNotices = (noticesData?.notices ?? []).slice(0, 5);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-lg hover:bg-muted transition-colors"
          data-testid="notifications-button"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Score Notices</h3>
          {unreadCount > 0 && (
            <button
              className="text-xs text-primary flex items-center gap-1 hover:underline"
              onClick={() => markAllReadMutation.mutate()}
            >
              <CheckCheck className="h-3 w-3" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {recentNotices.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              All clear — no notices right now
            </div>
          ) : (
            recentNotices.map((notice) => (
              <div
                key={notice.id}
                className={`px-4 py-3 border-b last:border-0 flex gap-3 cursor-pointer hover:bg-muted/30 transition-colors ${!notice.isRead ? 'bg-primary/5' : ''}`}
                onClick={() => !notice.isRead && markReadMutation.mutate(notice.id)}
              >
                <NoticeIcon category={notice.category} severity={notice.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-snug line-clamp-2">{notice.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(notice.createdAt), { addSuffix: true })}
                  </p>
                </div>
                {!notice.isRead && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1 shrink-0" />
                )}
              </div>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t">
          <Link
            href="/my-score?tab=notices"
            className="text-xs text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            View all notices →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MobileBellButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: noticesData } = useQuery<{ notices: ScoreNotice[]; unreadCount: number }>({
    queryKey: ['/api/gamification/notices'],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('PATCH', `/api/gamification/notices/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/gamification/notices'] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => apiRequest('PATCH', '/api/gamification/notices/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/gamification/notices'] }),
  });

  const unreadCount = noticesData?.unreadCount ?? 0;
  const recentNotices = (noticesData?.notices ?? []).slice(0, 5);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-1.5" data-testid="notifications-button">
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 min-w-[14px] h-3.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Score Notices</h3>
          {unreadCount > 0 && (
            <button
              className="text-xs text-primary flex items-center gap-1 hover:underline"
              onClick={() => markAllReadMutation.mutate()}
            >
              <CheckCheck className="h-3 w-3" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {recentNotices.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              All clear — no notices right now
            </div>
          ) : (
            recentNotices.map((notice) => (
              <div
                key={notice.id}
                className={`px-4 py-3 border-b last:border-0 flex gap-3 cursor-pointer hover:bg-muted/30 transition-colors ${!notice.isRead ? 'bg-primary/5' : ''}`}
                onClick={() => !notice.isRead && markReadMutation.mutate(notice.id)}
              >
                <NoticeIcon category={notice.category} severity={notice.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-snug line-clamp-2">{notice.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(notice.createdAt), { addSuffix: true })}
                  </p>
                </div>
                {!notice.isRead && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1 shrink-0" />
                )}
              </div>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t">
          <Link
            href="/my-score?tab=notices"
            className="text-xs text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            View all notices →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function TopNavigation() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [location, navigate] = useLocation();

  const pageTitle = pageTitles[location] || 'Taime';

  const openLetUsKnow = () => navigate('/issues');
  const openAskAra = () => window.dispatchEvent(new Event("open-ask-ara"));

  if (isMobile) {
    return (
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <i className="fas fa-clock text-primary-foreground text-xs"></i>
            </div>
            <h1 className="text-base font-semibold">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={openLetUsKnow}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              aria-label="Let us Know"
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              onClick={openAskAra}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              aria-label="Ask Ara"
            >
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </button>
            <MobileBellButton />
            {user && <UserButton afterSignOutUrl="/" />}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-6">
        <div>
          <h1 className="text-lg font-semibold">{pageTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            onClick={openLetUsKnow}
          >
            <Pencil className="h-3.5 w-3.5" />
            Let us Know
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            onClick={openAskAra}
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            Ask Ara
          </Button>
          <NotificationsDropdown />
          {user && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm font-medium text-foreground leading-tight">
                  {user.firstName} {user.lastName}
                </div>
                {user.role && (
                  <div className="text-xs text-muted-foreground capitalize leading-tight">
                    {user.role.displayName || user.role.name}
                  </div>
                )}
              </div>
              <UserButton afterSignOutUrl="/" />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
