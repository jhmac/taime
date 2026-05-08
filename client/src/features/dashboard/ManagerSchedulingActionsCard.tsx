import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, CheckCircle2, Square } from 'lucide-react';

type ActionSeverity = 'red' | 'orange' | 'green' | 'blue' | 'amber';

interface SchedulingAction {
  id: string;
  severity: ActionSeverity;
  title: string;
  subtitle: string;
  linkTarget: string;
  urgency: number;
}

const severityLeft: Record<ActionSeverity, string> = {
  red:    'border-l-4 border-l-red-500',
  orange: 'border-l-4 border-l-orange-500',
  green:  'border-l-4 border-l-emerald-500',
  blue:   'border-l-4 border-l-blue-500',
  amber:  'border-l-4 border-l-amber-500',
};

const severityBadge: Record<ActionSeverity, string> = {
  red:    'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
  orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
  green:  'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  blue:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  amber:  'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
};

const severityBadgeLabel: Record<ActionSeverity, string> = {
  red:    'Urgent',
  orange: 'Warning',
  green:  'All clear',
  blue:   'Info',
  amber:  'Action',
};

function SchedulingActionRow({
  item,
  onNavigate,
}: {
  item: SchedulingAction;
  onNavigate: (path: string) => void;
}) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-card rounded-lg border border-border shadow-sm flex items-start gap-3 px-4 py-3',
        severityLeft[item.severity]
      )}
    >
      <Square className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{item.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.subtitle}</p>
        {item.linkTarget && (
          <button
            onClick={() => onNavigate(item.linkTarget)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 flex items-center gap-0.5"
          >
            Go there <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <span
        className={cn(
          'text-xs font-medium px-2 py-0.5 rounded border whitespace-nowrap shrink-0 mt-0.5',
          severityBadge[item.severity]
        )}
      >
        {severityBadgeLabel[item.severity]}
      </span>
    </div>
  );
}

const STORAGE_KEY = 'taime_panel_mgr_actions';

function readStoredOpen(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val === null ? true : val !== 'false';
  } catch {
    return true;
  }
}

interface Props {
  enabled: boolean;
}

export default function ManagerSchedulingActionsCard({ enabled }: Props) {
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState<boolean>(readStoredOpen);

  const { data: actions, isLoading, error } = useQuery<SchedulingAction[]>({
    queryKey: ['/api/dashboard/manager-scheduling-actions'],
    enabled,
    staleTime: 2 * 60 * 1000,
  });

  if (error) throw error;

  const count = actions?.length ?? 0;

  const toggle = () => {
    setIsOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  };

  return (
    <Card className="border-border shadow-sm">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Actions Required</span>
          {!isLoading && (
            <span
              className={cn(
                'text-xs font-medium px-2 py-0.5 rounded-full border',
                count > 0
                  ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
              )}
            >
              {count}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <CardContent className="px-4 pb-4 pt-0 flex flex-col gap-2">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </>
          ) : count === 0 ? (
            <div
              className={cn(
                'bg-white dark:bg-card rounded-lg border border-border shadow-sm flex items-center gap-3 px-4 py-3',
                severityLeft['green']
              )}
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <p className="text-sm text-muted-foreground">All clear — no scheduling actions right now</p>
            </div>
          ) : (
            (actions ?? [])
              .slice()
              .sort((a, b) => b.urgency - a.urgency)
              .map(item => (
                <SchedulingActionRow
                  key={item.id}
                  item={item}
                  onNavigate={navigate}
                />
              ))
          )}
        </CardContent>
      )}
    </Card>
  );
}
