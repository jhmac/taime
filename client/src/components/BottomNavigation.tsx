import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Home, Calendar, Users, MessageCircle, Settings, LayoutDashboard, Sparkles, type LucideIcon } from 'lucide-react';

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
      className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom"
      style={{
        background: 'linear-gradient(to top, var(--background) 55%, transparent)',
        paddingTop: 10,
      }}
      data-testid="bottom-navigation"
    >
      <div
        className="mx-3 mb-2 rounded-[24px] border border-border/60 backdrop-blur-xl"
        style={{
          backgroundColor: 'rgba(255,255,255,0.88)',
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          padding: '6px 14px 4px',
        }}
      >
        <div className="flex justify-between items-center">
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
                className="flex flex-col items-center gap-1 relative transition-transform active:scale-95 min-w-0 flex-1"
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {active ? (
                  <>
                    <div
                      className="w-10 h-10 rounded-[18px] flex items-center justify-center shadow-sm"
                      style={{ backgroundColor: 'var(--primary)' }}
                    >
                      <Icon size={18} strokeWidth={2.5} className="text-white" />
                    </div>
                    <span className="text-[10px] font-semibold leading-none" style={{ color: 'var(--primary)' }}>
                      {item.label}
                    </span>
                  </>
                ) : (
                  <div className="flex flex-col items-center pt-1.5 pb-0.5 relative">
                    <Icon size={18} strokeWidth={1.8} className="text-muted-foreground" />
                    {item.badge && unreadCount > 0 && (
                      <span className="absolute -top-1 -right-2.5 bg-red-500 text-white text-[9px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-0.5">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="w-28 h-1 rounded-full mx-auto mb-1" style={{ backgroundColor: 'rgba(13,31,60,0.12)' }} />
    </nav>
  );
}
