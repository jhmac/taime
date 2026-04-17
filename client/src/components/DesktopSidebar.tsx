import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';

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
  { path: '/ai-studio', icon: 'fas fa-wand-magic-sparkles', label: 'AI Studio', permission: 'hr.edit_team' },
  { path: '/ai-questions', icon: 'fas fa-question-circle', label: 'AI Questions', permission: 'hr.view_team' },
  { path: '/operations', icon: 'fas fa-cogs', label: 'Operations', permission: 'admin.manage_all' },
  { path: '/admin', icon: 'fas fa-sliders-h', label: 'Settings', permission: 'admin.manage_all' },
];

type SectionKey = 'general' | 'gtd' | 'management';

function getSectionForPath(path: string): SectionKey | null {
  if (generalNavItems.some(i => i.path === path || (path !== '/' && path.startsWith(i.path)))) return 'general';
  if (gtdNavItems.some(i => path.startsWith(i.path))) return 'gtd';
  if (managementNavItems.some(i => path.startsWith(i.path))) return 'management';
  return null;
}

const STORAGE_KEY = 'sidebar-sections';

function loadSections(activeSection: SectionKey | null): Record<SectionKey, boolean> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {
    general: activeSection === 'general',
    gtd: activeSection === 'gtd',
    management: activeSection === 'management',
  };
}

export default function DesktopSidebar() {
  const [location, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner' || user?.role?.name === 'manager';

  const activeSection = getSectionForPath(location);

  const [sections, setSections] = useState<Record<SectionKey, boolean>>(() =>
    loadSections(activeSection)
  );

  // Auto-expand the section of the active route
  useEffect(() => {
    if (activeSection && !sections[activeSection]) {
      setSections(prev => {
        const next = { ...prev, [activeSection]: true };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    }
  }, [location]);

  function toggleSection(key: SectionKey) {
    setSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

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

  const { data: unansweredCountData } = useQuery<{ pending: number }>({
    queryKey: ['/api/ai/questions/count'],
    enabled: isAdmin,
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unansweredCount = unansweredCountData?.pending || 0;

  function NavButton({ path, icon, label, badge }: { path: string; icon: string; label: string; badge?: number }) {
    const isActive = location === path || (path !== '/' && location.startsWith(path));
    return (
      <button
        onClick={() => navigate(path)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          collapsed && "justify-center px-0"
        )}
        title={collapsed ? label : undefined}
      >
        <div className="relative flex-shrink-0">
          <i className={cn(icon, "w-5 text-center")}></i>
          {badge != null && badge > 0 && (
            <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-0.5">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </div>
        {!collapsed && <span className="flex-1 text-left">{label}</span>}
        {!collapsed && badge != null && badge > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    );
  }

  function SectionHeader({ sectionKey, label, hasActive }: { sectionKey: SectionKey; label: string; hasActive: boolean }) {
    const open = sections[sectionKey];
    if (collapsed) {
      return <div className="border-t border-sidebar-border mx-2 my-2" />;
    }
    return (
      <button
        onClick={() => toggleSection(sectionKey)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors group",
          "hover:bg-sidebar-accent/50"
        )}
      >
        <span className={cn(
          "text-xs font-semibold uppercase tracking-wider transition-colors",
          hasActive ? "text-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70"
        )}>
          {label}
        </span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-sidebar-foreground/40" />
          : <ChevronRight className="w-3.5 h-3.5 text-sidebar-foreground/40" />
        }
      </button>
    );
  }

  const generalItems = generalNavItems.filter(
    item => !('employeeOnly' in item && item.employeeOnly) || !isAdmin
  );

  const generalActive = generalItems.some(
    i => location === i.path || (i.path !== '/' && location.startsWith(i.path))
  );
  const gtdActive = gtdNavItems.some(i => location.startsWith(i.path));
  const managementActive = managementNavItems.some(i => location.startsWith(i.path));

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

      <nav className="flex-1 p-2 overflow-y-auto">
        {/* Ask AI — always visible */}
        <button
          onClick={() => window.dispatchEvent(new Event('open-ask-mainager'))}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors mb-1",
            "bg-primary/10 text-primary hover:bg-primary/20 font-medium",
            collapsed && "justify-center px-0"
          )}
          title={collapsed ? 'Ask AI' : undefined}
        >
          <Sparkles className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="flex-1 text-left">Ask AI</span>}
        </button>

        {/* General section */}
        <div className="mt-1">
          <SectionHeader sectionKey="general" label="General" hasActive={generalActive} />
          {sections.general && (
            <div className="mt-0.5 space-y-0.5">
              {generalItems.map(item => (
                <NavButton
                  key={item.path}
                  path={item.path}
                  icon={item.icon}
                  label={item.label}
                  badge={item.path === '/messages' ? unreadCount : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* GTD section */}
        <div className="mt-1">
          <SectionHeader sectionKey="gtd" label="GTD" hasActive={gtdActive} />
          {sections.gtd && (
            <div className="mt-0.5 space-y-0.5">
              {gtdNavItems.map(item => (
                <NavButton key={item.path} {...item} />
              ))}
            </div>
          )}
        </div>

        {/* Management section */}
        {isAdmin && (
          <div className="mt-1">
            <SectionHeader sectionKey="management" label="Management" hasActive={managementActive} />
            {sections.management && (
              <div className="mt-0.5 space-y-0.5">
                {managementNavItems.map(item => (
                  <NavButton
                    key={item.path}
                    {...item}
                    badge={item.path === '/ai-questions' ? unansweredCount : undefined}
                  />
                ))}
              </div>
            )}
          </div>
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
