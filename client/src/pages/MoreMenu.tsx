import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useClerk } from '@clerk/clerk-react';
import {
  User, Clock, Heart, Megaphone, GraduationCap, Trophy, BarChart2,
  AlertTriangle, FileText, Users, Video, Inbox, Zap, FolderOpen,
  Hourglass, Sprout, ClipboardCheck, ClipboardList, DollarSign,
  FileSpreadsheet, UserCog, ShieldCheck, BarChart, Medal,
  Settings, Cog, LogOut, ChevronRight, Banknote, Building2,
  Coffee, Lightbulb, LifeBuoy, History, FileDown, Mic, Brain,
  type LucideIcon,
} from 'lucide-react';

interface MenuItem {
  icon: LucideIcon;
  label: string;
  subtitle?: string;
  path?: string;
  action?: () => void;
  iconBg: string;
  iconColor: string;
}

interface Section {
  title: string;
  items: MenuItem[];
  adminOnly?: boolean;
}

function NavRow({ item }: { item: MenuItem }) {
  const [, navigate] = useLocation();
  const Icon = item.icon;
  return (
    <button
      onClick={() => item.action ? item.action() : item.path && navigate(item.path)}
      className="w-full flex items-center gap-3 py-3 px-4 hover:bg-muted/40 transition-colors active:bg-muted/60"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${item.iconBg}`}>
        <Icon size={17} className={item.iconColor} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="text-sm font-semibold text-foreground">{item.label}</div>
        {item.subtitle && (
          <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
        )}
      </div>
      <ChevronRight size={15} className="text-muted-foreground/50 flex-shrink-0" />
    </button>
  );
}

export default function MoreMenu() {
  const { user } = useAuth();
  const { signOut } = useClerk();
  const [, navigate] = useLocation();

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner' || user?.role?.name === 'manager';
  const initials = `${(user?.firstName || '')[0] || ''}${(user?.lastName || '')[0] || ''}`.toUpperCase();

  const sections: Section[] = [
    {
      title: 'You',
      items: [
        { icon: User, label: 'Profile', subtitle: 'Edit your info & preferences', path: '/employee-settings', iconBg: 'bg-orange-100', iconColor: 'text-orange-600' },
        { icon: Trophy, label: 'My Score', subtitle: 'Performance score, tier & badges', path: '/my-score', iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600' },
        { icon: Clock, label: 'Availability', subtitle: 'Set your weekly availability', path: '/availability', iconBg: 'bg-teal-100', iconColor: 'text-teal-600' },
        { icon: FileText, label: 'Requests', subtitle: 'Time off, shift trades & cover', path: '/requests', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
        { icon: Banknote, label: 'Payroll', subtitle: 'View your pay & cash out', path: '/payroll', iconBg: 'bg-green-100', iconColor: 'text-green-600' },
      ],
    },
    {
      title: 'Engage',
      items: [
        { icon: Heart, label: 'Kudos', subtitle: 'Give & receive recognition', path: '/kudos', iconBg: 'bg-red-100', iconColor: 'text-red-500' },
        { icon: Megaphone, label: 'Shoutouts', subtitle: 'Team announcements & wins', path: '/communication', iconBg: 'bg-purple-100', iconColor: 'text-purple-600' },
        { icon: Coffee, label: 'Morning Huddle', subtitle: 'Daily team standup', path: '/huddle', iconBg: 'bg-amber-100', iconColor: 'text-amber-700' },
        { icon: Coffee, label: 'Morning Whisper', subtitle: 'AI briefing for your day', path: '/whisper', iconBg: 'bg-orange-100', iconColor: 'text-orange-600' },
        { icon: GraduationCap, label: 'Learning', subtitle: 'SOPs, training & knowledge', path: '/learning', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600' },
        { icon: History, label: 'SOP Revisions', subtitle: 'Track SOP changes', path: '/sops/revisions', iconBg: 'bg-violet-100', iconColor: 'text-violet-600' },
        { icon: BarChart2, label: 'Lean Board', subtitle: 'Store performance metrics', path: '/lean-board', iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600' },
        { icon: Lightbulb, label: 'AI Insights', subtitle: 'Smart store analytics', path: '/insights', iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600' },
        { icon: Video, label: 'Improvements', subtitle: '60-second improvement videos', path: '/improvements', iconBg: 'bg-orange-100', iconColor: 'text-orange-500' },
        { icon: AlertTriangle, label: 'Issues', subtitle: 'Report a problem', path: '/issues', iconBg: 'bg-amber-100', iconColor: 'text-amber-600' },
        { icon: Users, label: 'Team Directory', subtitle: 'Find your teammates', path: '/team-directory', iconBg: 'bg-slate-100', iconColor: 'text-slate-600' },
        { icon: LifeBuoy, label: 'Support', subtitle: 'Help & contact', path: '/support', iconBg: 'bg-sky-100', iconColor: 'text-sky-600' },
      ],
    },
    {
      title: 'GTD — Get Things Done',
      items: [
        { icon: Inbox, label: 'Inbox', subtitle: 'Capture & triage new items', path: '/gtd/inbox', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
        { icon: Zap, label: 'Actions', subtitle: 'Next actions to do now', path: '/gtd/actions', iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600' },
        { icon: FolderOpen, label: 'Projects', subtitle: 'Multi-step outcomes', path: '/gtd/projects', iconBg: 'bg-teal-100', iconColor: 'text-teal-600' },
        { icon: Hourglass, label: 'Waiting', subtitle: 'Delegated, waiting for reply', path: '/gtd/waiting', iconBg: 'bg-orange-100', iconColor: 'text-orange-500' },
        { icon: Sprout, label: 'Someday', subtitle: 'Ideas for later', path: '/gtd/someday', iconBg: 'bg-green-100', iconColor: 'text-green-600' },
        { icon: ClipboardCheck, label: 'Weekly Review', subtitle: 'Reflect & plan your week', path: '/gtd/review', iconBg: 'bg-purple-100', iconColor: 'text-purple-600' },
      ],
    },
    {
      title: 'Management',
      adminOnly: true,
      items: [
        { icon: Mic, label: 'Meetings', subtitle: 'Record & review AI meeting notes', path: '/meetings', iconBg: 'bg-violet-100', iconColor: 'text-violet-600' },
        { icon: ClipboardList, label: 'Tasks', subtitle: 'Store task management', path: '/tasks', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
        { icon: Users, label: 'Team', subtitle: 'Staff roster & HR records', path: '/team', iconBg: 'bg-slate-100', iconColor: 'text-slate-600' },
        { icon: DollarSign, label: 'Payroll', subtitle: 'Pay runs & wage management', path: '/payroll', iconBg: 'bg-green-100', iconColor: 'text-green-600' },
        { icon: FileSpreadsheet, label: 'Timesheets', subtitle: 'Review & approve hours', path: '/timesheets', iconBg: 'bg-teal-100', iconColor: 'text-teal-600' },
        { icon: FileDown, label: 'Payroll Export', subtitle: 'Export payroll data', path: '/payroll-export', iconBg: 'bg-lime-100', iconColor: 'text-lime-600' },
        { icon: Building2, label: 'Cash Management', subtitle: 'Drawer counts & deposits', path: '/cash', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600' },
        { icon: UserCog, label: 'HR', subtitle: 'Onboarding & compliance', path: '/hr', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600' },
        { icon: ShieldCheck, label: 'Roles & Permissions', subtitle: 'Access control', path: '/hr/roles', iconBg: 'bg-red-100', iconColor: 'text-red-500' },
        { icon: BarChart, label: 'Analytics', subtitle: 'Reports & insights', path: '/analytics', iconBg: 'bg-purple-100', iconColor: 'text-purple-600' },
        { icon: Medal, label: 'Performance', subtitle: 'Team scorecards', path: '/performance', iconBg: 'bg-yellow-100', iconColor: 'text-yellow-600' },
        { icon: Brain, label: 'AI Learning Center', subtitle: 'Upload & build your knowledge base', path: '/ai-learning', iconBg: 'bg-violet-100', iconColor: 'text-violet-600' },
        { icon: Cog, label: 'Operations', subtitle: 'Store ops & SOPs', path: '/operations', iconBg: 'bg-orange-100', iconColor: 'text-orange-500' },
        { icon: Settings, label: 'Settings', subtitle: 'Store & app configuration', path: '/admin', iconBg: 'bg-slate-100', iconColor: 'text-slate-600' },
      ],
    },
    {
      title: 'Account',
      items: [
        { icon: Settings, label: 'App Settings', subtitle: 'Notifications, calendar sync', path: '/employee-settings', iconBg: 'bg-slate-100', iconColor: 'text-slate-500' },
        {
          icon: LogOut, label: 'Sign Out', iconBg: 'bg-red-50', iconColor: 'text-red-500',
          action: () => signOut({ redirectUrl: '/' }),
        },
      ],
    },
  ];

  const visibleSections = sections.filter(s => !s.adminOnly || isAdmin);

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/95 backdrop-blur z-10 px-4 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base flex-shrink-0">
            {user?.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-foreground leading-tight">
              {user?.firstName} {user?.lastName}
            </h1>
            <p className="text-xs text-muted-foreground capitalize">{user?.role?.name || 'Staff'}</p>
          </div>
        </div>
      </div>

      <div className="pb-4">
        {visibleSections.map((section) => (
          <div key={section.title} className="mt-5">
            <div className="px-4 mb-1">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </span>
            </div>
            <div className="bg-card mx-3 rounded-2xl overflow-hidden shadow-sm border border-border/50">
              {section.items.map((item, i) => (
                <div key={i} className={i < section.items.length - 1 ? 'border-b border-border/40' : ''}>
                  <NavRow item={item} />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="px-4 mt-6 mb-2">
          <div className="bg-primary/5 rounded-2xl p-4 text-center border border-primary/10">
            <div className="text-xs text-muted-foreground mb-1">Your Taime PIN</div>
            <div className="text-3xl font-bold tracking-widest font-mono text-foreground">
              {String(Math.abs(hashCode(user?.id || 'default'))).slice(0, 6).padStart(6, '0')}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">Use this to clock in at a shared device</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
