import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

const TIER_COLORS: Record<string, string> = {
  bronze: 'text-orange-600',
  silver: 'text-gray-500',
  gold: 'text-yellow-500',
  platinum: 'text-blue-500',
  diamond: 'text-purple-500',
};

const generalNavItems = [
  { path: '/', icon: 'fas fa-home', label: 'Dashboard' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedules' },
  { path: '/availability', icon: 'fas fa-clock', label: 'Availability' },
  { path: '/messages', icon: 'fas fa-comments', label: 'Messages' },
  { path: '/kudos', icon: 'fas fa-heart', label: 'Kudos' },
  { path: '/communication', icon: 'fas fa-bullhorn', label: 'Shoutouts' },
  { path: '/huddle', icon: 'fas fa-mug-hot', label: 'Morning Huddle' },
  { path: '/whisper', icon: 'fas fa-coffee', label: 'Morning Whisper' },
  { path: '/learning', icon: 'fas fa-graduation-cap', label: 'Learning' },
  { path: '/sops/revisions', icon: 'fas fa-history', label: 'SOP Revisions' },
  { path: '/improvements', icon: 'fas fa-video', label: 'Improvement Feed' },
  { path: '/my-score', icon: 'fas fa-trophy', label: 'My Score' },
  { path: '/lean-board', icon: 'fas fa-chart-line', label: 'Lean Board' },
  { path: '/insights', icon: 'fas fa-lightbulb', label: 'AI Insights' },
  { path: '/issues', icon: 'fas fa-exclamation-triangle', label: 'Issues' },
  { path: '/support', icon: 'fas fa-life-ring', label: 'Support' },
  { path: '/requests', icon: 'fas fa-file-alt', label: 'Requests', employeeOnly: true },
  { path: '/team-directory', icon: 'fas fa-users', label: 'Team', employeeOnly: true },
  { path: '/employee-settings', icon: 'fas fa-user-cog', label: 'Settings', employeeOnly: true },
] as const;

const gtdNavItems = [
  { path: '/gtd/inbox', icon: 'fas fa-inbox', label: 'Inbox' },
  { path: '/gtd/actions', icon: 'fas fa-bolt', label: 'Actions' },
  { path: '/gtd/projects', icon: 'fas fa-project-diagram', label: 'Projects' },
  { path: '/gtd/waiting', icon: 'fas fa-hourglass-half', label: 'Waiting' },
  { path: '/gtd/someday', icon: 'fas fa-seedling', label: 'Someday' },
  { path: '/gtd/review', icon: 'fas fa-clipboard-check', label: 'Review' },
];

const managementNavItems = [
  { path: '/meetings', icon: 'fas fa-microphone', label: 'Meetings' },
  { path: '/tasks', icon: 'fas fa-clipboard-list', label: 'Tasks', permission: 'tasks.view_all' },
  { path: '/team', icon: 'fas fa-users', label: 'Team', permission: 'hr.view_team' },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Payroll', permission: 'hr.payroll_view' },
  { path: '/timesheets', icon: 'fas fa-file-invoice', label: 'Timesheets', permission: 'hr.payroll_view' },
  { path: '/mileage-report', icon: 'fas fa-car', label: 'Mileage Report', permission: 'hr.payroll_view' },
  { path: '/payroll-export', icon: 'fas fa-file-export', label: 'Payroll Export', permission: 'hr.payroll_view' },
  { path: '/supply', icon: 'fas fa-boxes', label: 'Supply Kanban', permission: 'tasks.view_all' },
  { path: '/cash', icon: 'fas fa-cash-register', label: 'Cash' },
  { path: '/hr', icon: 'fas fa-user-tie', label: 'HR', permission: 'hr.view_team' },
  { path: '/hr/roles', icon: 'fas fa-shield-alt', label: 'Roles', permission: 'admin.role_management' },
  { path: '/analytics', icon: 'fas fa-chart-bar', label: 'Analytics', permission: 'admin.manage_all' },
  { path: '/performance', icon: 'fas fa-trophy', label: 'Performance' },
  { path: '/ai-learning', icon: 'fas fa-brain', label: 'AI Learning', permission: 'hr.edit_team' },
  { path: '/operations', icon: 'fas fa-cogs', label: 'Operations', permission: 'admin.manage_all' },
  { path: '/admin', icon: 'fas fa-sliders-h', label: 'Settings', permission: 'admin.manage_all' },
];

export default function DesktopSidebar() {
  const [location, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner' || user?.role?.name === 'manager';

  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.count || 0;

  const { data: miniScore } = useQuery<{ overallScore: number; tier: string }>({
    queryKey: ['/api/gamification/my-score'],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  function NavButton({ path, icon, label, badge }: { path: string; icon: string; label: string; badge?: number }) {
    const isActive = location === path || (path !== '/' && location.startsWith(path));
    return (
      <button
        onClick={() => navigate(path)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          collapsed && "justify-center px-0"
        )}
        title={collapsed ? label : undefined}
      >
        <div className="relative">
          <i className={cn(icon, "w-5 text-center")}></i>
          {badge != null && badge > 0 && (
            <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-0.5">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </div>
        {!collapsed && (
          <span className="flex-1 text-left">{label}</span>
        )}
        {!collapsed && badge != null && badge > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside
      className={cn(
        "h-screen sticky top-0 bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className={cn("flex items-center gap-2 p-4 border-b border-sidebar-border", collapsed && "justify-center")}>
        {collapsed ? (
          <img src="/taime-icon.png" alt="Taime" className="w-8 h-8 object-contain" />
        ) : (
          <img src="/TAIME-logo.png" alt="Taime" className="h-8 w-auto" />
        )}
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        <button
          onClick={() => window.dispatchEvent(new Event('open-ask-mainager'))}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
            "bg-primary/10 text-primary hover:bg-primary/20 font-medium",
            collapsed && "justify-center px-0"
          )}
          title={collapsed ? 'Ask AI' : undefined}
        >
          <Sparkles className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="flex-1 text-left">Ask AI</span>}
        </button>

        {generalNavItems
          .filter(item => !('employeeOnly' in item && item.employeeOnly) || !isAdmin)
          .map(item => (
            <NavButton
              key={item.path}
              path={item.path}
              icon={item.icon}
              label={item.label}
              badge={item.path === '/messages' ? unreadCount : undefined}
            />
          ))}

        <div className={cn("pt-4 pb-1", collapsed && "pt-2 pb-0")}>
          {!collapsed && (
            <span className="px-3 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
              GTD
            </span>
          )}
          {collapsed && <div className="border-t border-sidebar-border mx-2"></div>}
        </div>
        {gtdNavItems.map(item => (
          <NavButton key={item.path} {...item} />
        ))}

        {isAdmin && (
          <>
            <div className={cn("pt-4 pb-1", collapsed && "pt-2 pb-0")}>
              {!collapsed && (
                <span className="px-3 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
                  Management
                </span>
              )}
              {collapsed && <div className="border-t border-sidebar-border mx-2"></div>}
            </div>
            {managementNavItems.map(item => (
              <NavButton key={item.path} {...item} />
            ))}
          </>
        )}
      </nav>

      {miniScore && (
        <div
          onClick={() => navigate('/my-score')}
          className={cn(
            "mx-2 mb-1 p-2 rounded-lg cursor-pointer hover:bg-sidebar-accent transition-colors border border-sidebar-border",
            collapsed ? "flex justify-center" : "flex items-center gap-2"
          )}
        >
          <div className="relative flex-shrink-0">
            <svg width="28" height="28" className="transform -rotate-90">
              <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="3" className="text-sidebar-border" />
              <circle cx="14" cy="14" r="11" fill="none" strokeWidth="3" strokeLinecap="round"
                className={TIER_COLORS[miniScore.tier] || TIER_COLORS.bronze}
                style={{ stroke: 'currentColor' }}
                strokeDasharray={2 * Math.PI * 11}
                strokeDashoffset={2 * Math.PI * 11 * (1 - miniScore.overallScore / 100)} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[9px] font-bold text-sidebar-foreground">{miniScore.overallScore}</span>
            </div>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-xs font-medium text-sidebar-foreground capitalize">{miniScore.tier}</span>
            </div>
          )}
        </div>
      )}

      <div className="p-2 border-t border-sidebar-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <i className={cn("fas", collapsed ? "fa-angle-double-right" : "fa-angle-double-left")}></i>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
