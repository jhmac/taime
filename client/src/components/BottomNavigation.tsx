import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Home, Calendar, MessageCircle, Settings, LayoutDashboard, Sparkles, type LucideIcon } from 'lucide-react';

type NavItem = {
  path?: string;
  action?: () => void;
  icon: LucideIcon;
  label: string;
  badge?: boolean;
  key: string;
};

function openAskMAinager() {
  window.dispatchEvent(new Event('open-ask-mainager'));
}

const adminNavItems: NavItem[] = [
  { key: 'home', path: '/', icon: LayoutDashboard, label: 'Home' },
  { key: 'schedule', path: '/schedules', icon: Calendar, label: 'Schedule' },
  { key: 'ai', action: openAskMAinager, icon: Sparkles, label: 'Ask AI' },
  { key: 'messages', path: '/messages', icon: MessageCircle, label: 'Messages', badge: true },
  { key: 'more', path: '/more', icon: Settings, label: 'More' },
];

const employeeNavItems: NavItem[] = [
  { key: 'home', path: '/', icon: Home, label: 'Home' },
  { key: 'schedule', path: '/schedules', icon: Calendar, label: 'Schedule' },
  { key: 'ai', action: openAskMAinager, icon: Sparkles, label: 'Ask AI' },
  { key: 'messages', path: '/messages', icon: MessageCircle, label: 'Messages', badge: true },
  { key: 'more', path: '/more', icon: Settings, label: 'More' },
];

export default function BottomNavigation() {
  const [location, navigate] = useLocation();
  const { user } = useAuth() as { user: { role?: { name?: string } } | null };
  const [aiSheetOpen, setAiSheetOpen] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      setAiSheetOpen((e as CustomEvent<{ isOpen: boolean }>).detail.isOpen);
    };
    window.addEventListener("ask-mainager-state", handler);
    return () => window.removeEventListener("ask-mainager-state", handler);
  }, []);

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';
  const navItems = isAdmin ? adminNavItems : employeeNavItems;

  const { data: unreadData } = useQuery<{ success: boolean; data: { count: number } }>({
    queryKey: ["/api/messages/unread-count"],
    refetchInterval: 30000,
  });
  const unreadCount = unreadData?.data?.count || 0;

  const moreRoutes = [
    '/more', '/requests', '/team-directory', '/employee-settings', '/support',
    '/profile', '/my-score', '/availability',
    '/learning', '/lean-board', '/improvements', '/issues', '/gtd',
    '/tasks', '/payroll', '/timesheets', '/payroll-export', '/cash',
    '/hr', '/analytics', '/performance', '/operations', '/admin',
  ];

  const isActive = (item: NavItem) => {
    if (item.key === 'ai') return aiSheetOpen;
    if (!item.path) return false;
    if (item.path === '/') return location === '/';
    if (item.path === '/more') {
      return location === '/more' || moreRoutes.some(r => location === r || location.startsWith(r + '/'));
    }
    return location === item.path || location.startsWith(item.path + '/');
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border safe-area-bottom"
      data-testid="bottom-navigation"
    >
      <div className="flex items-stretch">
        {navItems.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          const handleClick = () => {
            if (item.action) {
              item.action();
            } else if (item.path) {
              navigate(item.path);
            }
          };
          return (
            <button
              key={item.key}
              onClick={handleClick}
              className="flex flex-col items-center justify-center gap-1 flex-1 py-2.5 relative active:opacity-70 transition-opacity"
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <span className="relative">
                <Icon
                  size={22}
                  strokeWidth={active ? 2.2 : 1.7}
                  style={{ color: active ? 'var(--primary)' : 'hsl(220 15% 55%)' }}
                />
                {item.badge && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-2.5 bg-red-500 text-white text-[9px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-0.5">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <span
                className="text-[10px] leading-none"
                style={{
                  color: active ? 'var(--primary)' : 'hsl(220 15% 55%)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
