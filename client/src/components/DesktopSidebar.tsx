import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { Permission } from '@shared/schema';

const generalNavItems = [
  { path: '/', icon: 'fas fa-home', label: 'Dashboard' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedules' },
  { path: '/availability', icon: 'fas fa-clock', label: 'Availability' },
  { path: '/messages', icon: 'fas fa-comments', label: 'Messages' },
  { path: '/communication', icon: 'fas fa-bullhorn', label: 'Shoutouts' },
  { path: '/learning', icon: 'fas fa-graduation-cap', label: 'Learning' },
  { path: '/issues', icon: 'fas fa-exclamation-triangle', label: 'Issues' },
  { path: '/requests', icon: 'fas fa-file-alt', label: 'Requests', employeeOnly: true },
  { path: '/team-directory', icon: 'fas fa-users', label: 'Team', employeeOnly: true },
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
  { path: '/tasks', icon: 'fas fa-clipboard-list', label: 'Tasks', permission: 'tasks.view_all' },
  { path: '/team', icon: 'fas fa-users', label: 'Team', permission: 'hr.view_team' },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Payroll', permission: 'hr.payroll_view' },
  { path: '/hr', icon: 'fas fa-user-tie', label: 'HR', permission: 'hr.view_team' },
  { path: '/hr/roles', icon: 'fas fa-shield-alt', label: 'Roles', permission: 'admin.role_management' },
  { path: '/analytics', icon: 'fas fa-chart-bar', label: 'Analytics', permission: 'hr.view_team' },
  { path: '/performance', icon: 'fas fa-trophy', label: 'Performance' },
  { path: '/operations', icon: 'fas fa-cogs', label: 'Operations', permission: 'admin.manage_all' },
  { path: '/admin', icon: 'fas fa-sliders-h', label: 'Settings', permission: 'admin.manage_all' },
];

export default function DesktopSidebar() {
  const [location, navigate] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  const visibleManagementItems = managementNavItems.filter(item => {
    if (isAdmin) return true;
    return userPermissions.some(p => p.name === item.permission || p.name === 'admin.manage_all');
  });

  const showManagement = visibleManagementItems.length > 0;

  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.count || 0;

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
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <i className="fas fa-clock text-primary-foreground text-sm"></i>
        </div>
        {!collapsed && (
          <span className="font-semibold text-sidebar-foreground text-sm">Taime Clock</span>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
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

        {showManagement && (
          <>
            <div className={cn("pt-4 pb-1", collapsed && "pt-2 pb-0")}>
              {!collapsed && (
                <span className="px-3 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
                  Management
                </span>
              )}
              {collapsed && <div className="border-t border-sidebar-border mx-2"></div>}
            </div>
            {visibleManagementItems.map(item => (
              <NavButton key={item.path} {...item} />
            ))}
          </>
        )}
      </nav>

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
