import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Permission } from '@shared/schema';

const allNavItems = [
  { path: '/', icon: 'fas fa-home', label: 'Dashboard' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedules' },
  { path: '/availability', icon: 'fas fa-clock', label: 'Availability' },
  { path: '/communication', icon: 'fas fa-comments', label: 'Messages' },
  { divider: true, label: 'Management' },
  { path: '/team', icon: 'fas fa-users', label: 'Team', permission: 'hr.manage_employees' },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Payroll', permission: 'admin.manage_payroll' },
  { path: '/hr', icon: 'fas fa-user-tie', label: 'HR', permission: 'hr.manage_employees' },
  { path: '/hr/roles', icon: 'fas fa-shield-alt', label: 'Roles', permission: 'admin.role_management' },
  { path: '/operations', icon: 'fas fa-cogs', label: 'Operations', permission: 'admin.manage_all' },
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

  const visibleItems = allNavItems.filter(item => {
    if ('divider' in item && item.divider) {
      return isAdmin;
    }
    if ('permission' in item && item.permission) {
      if (isAdmin) return true;
      return userPermissions?.some?.(p => p.name === item.permission) || false;
    }
    return true;
  });

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
          <span className="font-semibold text-sidebar-foreground text-sm">ClockSync AI</span>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {visibleItems.map((item, idx) => {
          if ('divider' in item && item.divider) {
            return (
              <div key={`div-${idx}`} className={cn("pt-4 pb-1", collapsed && "pt-2 pb-0")}>
                {!collapsed && (
                  <span className="px-3 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
                    {item.label}
                  </span>
                )}
                {collapsed && <div className="border-t border-sidebar-border mx-2"></div>}
              </div>
            );
          }

          const navItem = item as { path: string; icon: string; label: string };
          const isActive = location === navItem.path || (navItem.path !== '/' && location.startsWith(navItem.path));

          return (
            <button
              key={navItem.path}
              onClick={() => navigate(navItem.path)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                collapsed && "justify-center px-0"
              )}
              title={collapsed ? navItem.label : undefined}
            >
              <i className={cn(navItem.icon, "w-5 text-center")}></i>
              {!collapsed && <span>{navItem.label}</span>}
            </button>
          );
        })}
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
