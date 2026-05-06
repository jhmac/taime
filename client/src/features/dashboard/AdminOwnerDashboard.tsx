/**
 * AdminOwnerDashboard — Living Business Health Monitor
 *
 * 11 collapsible panels for admin/owner roles.
 * Each panel has: last-refreshed timestamp, loading skeleton, empty state.
 *
 * Panels:
 *  1. AI Morning Briefing
 *  2. Floor Status          (all locations; schedule.locationId grouping; break + offsite)
 *  3. Sales vs. Goal
 *  4. Payroll Health        (SPLH + employee table; prior-7d via raw-total subtraction)
 *  5. Performance           (top/bottom N + category bars + 7d delta)
 *  6. HR Actions            (clock-events tardiness; ended-shift no-shows; kudos 14d)
 *  7. Tasks Health
 *  8. Supplies
 *  9. Issues
 * 10. Upcoming Shifts       (future-only today; Upcoming This Week strip)
 * 11. Cash Status
 *
 * Action-Required strip: urgency-ordered chips that anchor-scroll to panels.
 */
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueries } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardErrorBoundary } from '@/features/dashboard/DashboardErrorBoundary';
import CashStatusCard from '@/features/dashboard/CashStatusCard';
import {
  ChevronDown, ChevronUp, Users, Clock, AlertTriangle,
  TrendingUp, TrendingDown, DollarSign, CheckSquare, Package,
  CircleAlert, Bot, Trophy, Calendar, RefreshCw, ArrowRight,
  CheckCircle2, XCircle, Star, UserCheck, Sun, BarChart3,
  MapPin, Navigation, Coffee,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  format, differenceInMinutes, differenceInDays, startOfDay,
  addDays, isSameDay,
} from 'date-fns';

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────
interface User {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  isActive?: boolean;
  locationId?: string | null;
  hourlyRate?: string | null;
  role?: string;
}

interface TimeEntry {
  id: string;
  userId: string;
  clockInTime: string;
  clockOutTime?: string | null;
  breakMinutes?: number;
  breakStartTime?: string | null;
  locationId?: string | null;
}

interface Schedule {
  id: string;
  userId: string;
  startTime: string;
  endTime: string;
  locationId?: string | null;
}

interface WorkLocation {
  id: string;
  name: string;
  isActive?: boolean;
}

interface ClockEvent {
  userId: string;
  eventType: string;
  createdAt: string;
}

interface OffsiteSession {
  id?: string;
  userId: string;
  status: string;
  destinationName?: string | null;
}

interface GamificationScore {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  overallScore: number;
  tier?: string;
  breakdown?: {
    attendance?: { normalized?: number };
    tasks?: { normalized?: number };
    sops?: { normalized?: number };
    engagement?: { normalized?: number };
    learning?: { normalized?: number };
  };
}

interface Task {
  id: string;
  title?: string;
  status?: string;
  dueDate?: string | null;
  updatedAt?: string | null;
  supplyItemId?: string | null;
  assignedTo?: string | null;
}

interface SupplyItem {
  id: string;
  name?: string;
  stockStatus?: string;
  pendingReorderTaskId?: string | null;
  reorderTaskId?: string | null;
}

interface Issue {
  id: string;
  title?: string;
  description?: string;
  priority?: string;
  severity?: string;
  createdAt?: string | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
}

interface DailyGoal {
  hasGoal?: boolean;
  goalEnabled?: boolean;
  goal?: { revenue?: number; orders?: number };
  current?: { revenue?: number; orders?: number };
  progress?: number;
  amountRemaining?: number;
  salesNeeded?: number;
  averageOrderValue?: number;
}

interface PayrollSummary {
  shopConnected?: boolean;
  grossSales?: number;
  totalHours?: number;
  totalLaborCost?: number;
  splh?: number;
  laborPct?: number;
  employees?: Array<{ userId: string; name: string; totalHours: number; laborCost: number; wageRate: number }>;
  settings?: { payrollTargetPct?: number };
}

interface Kudo {
  toEmployeeId?: string;
  createdAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function fmt(n: number | undefined | null, dec = 0): string {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(dec);
}
function fmtMoney(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function todayStr(): string { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(d: number): string {
  return new Date(Date.now() - d * 86400000).toISOString().split('T')[0];
}
function ageLabel(ds: string | null | undefined): string {
  if (!ds) return '';
  const d = differenceInDays(new Date(), new Date(ds));
  return d === 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`;
}
function uName(u: Pick<User, 'firstName' | 'lastName' | 'email'>): string {
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'Employee';
}
function refreshedLabel(tsMs: number): string {
  const mins = Math.floor((Date.now() - tsMs) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DashboardCard
// ─────────────────────────────────────────────────────────────────────────────
interface DashboardCardProps {
  title: string;
  icon: React.ReactNode;
  summaryRow: React.ReactNode;
  children: React.ReactNode;
  storageKey: string;
  panelId: string;
  navigateTo?: string;
  defaultExpanded?: boolean;
  accent?: 'default' | 'warning' | 'critical' | 'success';
  updatedAt?: number;
}

function DashboardCard({
  title, icon, summaryRow, children, storageKey, panelId,
  navigateTo, defaultExpanded = false, accent = 'default', updatedAt,
}: DashboardCardProps) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(`aod-card-${storageKey}`);
      if (s !== null) return s === 'true';
    } catch { /* ignore */ }
    return defaultExpanded;
  });
  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem(`aod-card-${storageKey}`, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);

  const borderMap: Record<string, string> = {
    default: '',
    warning: 'border-amber-300 dark:border-amber-700',
    critical: 'border-red-400 dark:border-red-700',
    success: 'border-emerald-300 dark:border-emerald-700',
  };

  return (
    <Card id={panelId} className={cn('overflow-hidden scroll-mt-4', borderMap[accent])}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0">{icon}</span>
            <CardTitle className="text-sm font-semibold truncate">{title}</CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {navigateTo && (
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground"
                onClick={() => navigate(navigateTo)}>
                <ArrowRight className="h-3 w-3" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={toggle}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className="text-xs text-muted-foreground">{summaryRow}</div>
          {updatedAt != null && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0">
              Updated {refreshedLabel(updatedAt)}
            </span>
          )}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="px-4 pb-4 pt-0 border-t border-border/50 mt-2">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Required Strip
// ─────────────────────────────────────────────────────────────────────────────
interface ActionItem {
  label: string;
  count: number;
  colorClass: string;
  panelId: string;
  urgency: number;
}
const C_RED    = 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300';
const C_AMBER  = 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300';
const C_ORANGE = 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300';
const C_BLUE   = 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300';

function ActionRequiredStrip({ items }: { items: ActionItem[] }) {
  const active = items.filter((i) => i.count > 0).sort((a, b) => a.urgency - b.urgency || b.count - a.count);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!active.length) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0" /> All clear — no urgent actions right now.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {active.map((item) => (
        <button key={`${item.panelId}-${item.label}`} onClick={() => scrollTo(item.panelId)}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-opacity hover:opacity-80', item.colorClass)}>
          <AlertTriangle className="h-3 w-3 shrink-0" />{item.count} {item.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Morning Briefing
// ─────────────────────────────────────────────────────────────────────────────
interface BriefingPayload {
  activeCount: number; scheduledCount: number; lateSinceOpen: number;
  salesVsGoalPct: number | null; openIssues: number; openTasks: number;
  payrollHealthPct: number | null; topPerformer: string | null; dayOfWeek: string;
}
function AIBriefingPanel(props: BriefingPayload) {
  const { data, mutate, isPending, isError } = useMutation({
    mutationFn: async (bypass?: boolean) => {
      const r = await apiRequest('POST', '/api/dashboard/ai-briefing', { ...props, bypassCache: bypass });
      return r.json() as Promise<{ briefing: string }>;
    },
  });
  useEffect(() => { mutate(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (isPending) return (
    <div className="space-y-2 pt-2">{[1, 0.9, 0.8, 0.85].map((w, i) => (
      <Skeleton key={i} className="h-3" style={{ width: `${w * 100}%` }} />
    ))}</div>
  );
  if (isError || !data?.briefing) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
      <XCircle className="h-4 w-4 text-red-400" /> Could not generate briefing.
      <Button variant="ghost" size="sm" className="h-6 px-2 ml-auto" onClick={() => mutate(false)}>
        <RefreshCw className="h-3 w-3 mr-1" />Retry
      </Button>
    </div>
  );
  return (
    <div className="pt-2">
      <p className="text-sm leading-relaxed text-foreground/90">{data.briefing}</p>
      <Button variant="ghost" size="sm" className="h-6 px-2 mt-2 text-xs text-muted-foreground"
        disabled={isPending} onClick={() => mutate(true)}>
        <RefreshCw className="h-3 w-3 mr-1" />Regenerate
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floor Status — ALL active locations; grouped by schedule.locationId
// ─────────────────────────────────────────────────────────────────────────────
function FloorStatusPanel({
  timeEntries, todaySchedules, users, locations, offsiteSessions, lateThresholdMinutes,
}: {
  timeEntries: TimeEntry[];
  todaySchedules: Schedule[];
  users: User[];
  locations: WorkLocation[];
  offsiteSessions: OffsiteSession[];
  lateThresholdMinutes: number;
}) {
  const now = new Date();
  const userMap = new Map(users.map((u) => [u.id, u]));
  const activeByUser = new Map<string, TimeEntry>(
    timeEntries.filter((e) => !e.clockOutTime).map((e) => [e.userId, e])
  );
  const offsiteMap = new Map<string, OffsiteSession>(
    offsiteSessions.filter((s) => s.status === 'active').map((s) => [s.userId, s])
  );
  const startedSchedules = todaySchedules.filter((s) => new Date(s.startTime) <= now);

  // Employees clocked in but with no schedule at any location (unassigned)
  const scheduledUidSet = new Set(startedSchedules.map((s) => s.userId));
  const unscheduledClocked = [...activeByUser.keys()].filter((uid) => !scheduledUidSet.has(uid));

  return (
    <div className="space-y-4 pt-2">
      {/* ALL active locations — never filtered out */}
      {locations.filter((l) => l.isActive !== false).map((loc) => {
        const locSchedules = startedSchedules.filter((s) => s.locationId === loc.id);
        const locSchedUids = new Set(locSchedules.map((s) => s.userId));

        // Employees with a schedule at this location AND currently clocked in
        const clockedIn = [...locSchedUids].filter((uid) => activeByUser.has(uid)).map((uid) => {
          const entry = activeByUser.get(uid)!;
          const sched = locSchedules.find((s) => s.userId === uid)!;
          const u = userMap.get(uid);
          const minsLate = differenceInMinutes(new Date(entry.clockInTime), new Date(sched.startTime));
          const late = minsLate > lateThresholdMinutes;
          const onBreak = !!entry.breakStartTime;
          const offsite = offsiteMap.get(uid);
          // Mismatch: employee clocked in at a different location than their scheduled location
          const mismatch = !!(entry.locationId && sched.locationId && entry.locationId !== sched.locationId);
          const dur = differenceInMinutes(now, new Date(entry.clockInTime));
          return { uid, u, entry, sched, late, onBreak, offsite, mismatch, dur };
        });

        // Employees with a schedule here but NOT clocked in (no-shows)
        const noShowUids = [...locSchedUids].filter((uid) => !activeByUser.has(uid));

        return (
          <div key={loc.id}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {loc.name}
              </span>
              <span className="text-xs text-muted-foreground">
                · {clockedIn.length}/{locSchedUids.size} in
              </span>
              {locSchedUids.size === 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30">
                  No shifts today
                </Badge>
              )}
            </div>
            {locSchedUids.size === 0 ? (
              <p className="text-xs text-muted-foreground italic px-2">No shifts scheduled at this location today.</p>
            ) : (
              <div className="divide-y divide-border/40 rounded-lg border border-border/50 overflow-hidden">
                {clockedIn.map(({ uid, u, sched, late, onBreak, offsite, mismatch, dur }) => {
                  const hrs = Math.floor(dur / 60);
                  const mins = dur % 60;
                  return (
                    <div key={uid} className="flex items-center justify-between px-2 py-1.5 text-sm bg-background">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full shrink-0', late ? 'bg-amber-400' : onBreak ? 'bg-orange-400' : 'bg-emerald-500')} />
                        <span className="font-medium">{u ? uName(u) : 'Employee'}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(sched.startTime), 'h:mma')}–{format(new Date(sched.endTime), 'h:mma')}
                        </span>
                        {late && !onBreak && <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 dark:text-amber-400">Late</Badge>}
                        {onBreak && <Badge variant="outline" className="text-xs border-orange-300 text-orange-600 dark:text-orange-400"><Coffee className="h-2.5 w-2.5 mr-0.5" />Break</Badge>}
                        {offsite && (
                          <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 dark:text-blue-400">
                            <Navigation className="h-2.5 w-2.5 mr-0.5" />
                            {offsite.destinationName ? offsite.destinationName : 'Off-site'}
                          </Badge>
                        )}
                        {mismatch && <Badge variant="outline" className="text-xs border-orange-300 text-orange-600 dark:text-orange-400"><MapPin className="h-2.5 w-2.5 mr-0.5" />Wrong loc.</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {hrs > 0 ? `${hrs}h ` : ''}{mins}m
                      </span>
                    </div>
                  );
                })}
                {noShowUids.map((uid) => {
                  const u = userMap.get(uid);
                  const sched = locSchedules.find((s) => s.userId === uid);
                  return (
                    <div key={uid} className="flex items-center justify-between px-2 py-1.5 text-sm bg-red-50/50 dark:bg-red-950/20">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                        <span className="font-medium text-muted-foreground">{u ? uName(u) : 'Employee'}</span>
                        {sched && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(sched.startTime), 'h:mma')}–{format(new Date(sched.endTime), 'h:mma')}
                          </span>
                        )}
                        <Badge variant="destructive" className="text-xs">No-show</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Employees clocked in without any scheduled shift today */}
      {unscheduledClocked.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Users className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unscheduled Clock-ins</span>
          </div>
          <div className="divide-y divide-border/40 rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
            {unscheduledClocked.map((uid) => {
              const u = userMap.get(uid);
              const entry = activeByUser.get(uid)!;
              const dur = differenceInMinutes(now, new Date(entry.clockInTime));
              return (
                <div key={uid} className="flex items-center justify-between px-2 py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                    <span className="font-medium">{u ? uName(u) : 'Employee'}</span>
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-600">No schedule</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {Math.floor(dur / 60) > 0 ? `${Math.floor(dur / 60)}h ` : ''}{dur % 60}m
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sales vs. Goal
// ─────────────────────────────────────────────────────────────────────────────
function SalesGoalPanel({ dailyGoal }: { dailyGoal: DailyGoal | null | undefined }) {
  if (!dailyGoal?.hasGoal || dailyGoal?.goal?.revenue == null) return (
    <p className="text-sm text-muted-foreground pt-2">
      {!dailyGoal?.goalEnabled
        ? 'Daily sales goal is disabled. Enable it in Settings.'
        : 'No historical sales data yet. Connect Shopify and backfill data to activate.'}
    </p>
  );
  const goalRevenue = dailyGoal.goal?.revenue ?? 0;
  const currentRevenue = dailyGoal.current?.revenue ?? 0;
  const pct = dailyGoal.progress ?? (goalRevenue > 0 ? Math.round((currentRevenue / goalRevenue) * 100) : 0);
  const amountRemaining = dailyGoal.amountRemaining ?? Math.max(goalRevenue - currentRevenue, 0);
  const barColor = pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-400' : 'bg-red-400';

  // Projected pace: what % of goal is expected by end of day based on current hour
  const now = new Date();
  const storeOpenHour = 9; const storeCloseHour = 21; // assume 9am–9pm trading window
  const tradingMinutesTotal = (storeCloseHour - storeOpenHour) * 60;
  const tradingMinutesElapsed = Math.max(0, Math.min(
    differenceInMinutes(now, new Date(now.getFullYear(), now.getMonth(), now.getDate(), storeOpenHour)),
    tradingMinutesTotal,
  ));
  const pacePct = tradingMinutesTotal > 0 ? Math.round((tradingMinutesElapsed / tradingMinutesTotal) * 100) : null;
  const projectedRevenue = pacePct != null && tradingMinutesElapsed > 0 && goalRevenue > 0
    ? Math.round((currentRevenue / (tradingMinutesElapsed / tradingMinutesTotal)) )
    : null;
  const paceBehind = projectedRevenue != null && projectedRevenue < goalRevenue;

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold">{fmtMoney(currentRevenue)}</p>
          <p className="text-xs text-muted-foreground">of {fmtMoney(goalRevenue)} goal</p>
        </div>
        <Badge variant={pct >= 100 ? 'default' : pct >= 70 ? 'secondary' : 'destructive'} className="text-xs">
          {pct}%
        </Badge>
      </div>

      {/* Progress bar with pace marker */}
      <div className="relative h-2 w-full bg-muted rounded-full overflow-visible">
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
        {pacePct != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground/30 rounded-full"
            style={{ left: `${Math.min(pacePct, 100)}%` }}
            title={`Expected ${pacePct}% sold by now`}
          />
        )}
      </div>

      {pct < 100 && (
        <p className="text-xs text-muted-foreground">
          {fmtMoney(amountRemaining)} remaining
          {dailyGoal.salesNeeded ? ` · ~${dailyGoal.salesNeeded} more transaction${dailyGoal.salesNeeded !== 1 ? 's' : ''} needed` : ''}
        </p>
      )}

      {/* Projected-pace line */}
      {projectedRevenue != null && tradingMinutesElapsed > 0 && (
        <p className={cn('text-xs', paceBehind ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
          {paceBehind ? '⚠ ' : '✓ '}
          At current pace: projected {fmtMoney(projectedRevenue)} by close
          {paceBehind && ` (${fmtMoney(goalRevenue - projectedRevenue)} short)`}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Health — SPLH + employee table; prior-period via raw-total subtraction
// ─────────────────────────────────────────────────────────────────────────────
function PayrollHealthPanel({
  summary, prev14d, topN,
}: {
  summary: PayrollSummary | null | undefined;
  prev14d: PayrollSummary | null | undefined;
  topN: number;
}) {
  if (!summary?.shopConnected) return (
    <p className="text-sm text-muted-foreground pt-2">
      Connect Shopify to enable payroll intelligence (SPLH, labor %, employee breakdown).
    </p>
  );
  const { totalHours = 0, totalLaborCost = 0, grossSales = 0, splh = 0, laborPct = 0, employees = [], settings } = summary;
  const target = settings?.payrollTargetPct ?? 30;
  const overTarget = laborPct > target;

  // Prior 7d = (14d totals) - (current 7d totals) — correct math, not percentage subtraction
  let prevLaborPct: number | null = null;
  let prevSplh: number | null = null;
  let prevHours: number | null = null;
  if (prev14d?.shopConnected) {
    const p7LaborCost = (prev14d.totalLaborCost ?? 0) - totalLaborCost;
    const p7GrossSales = (prev14d.grossSales ?? 0) - grossSales;
    const p7Hours = (prev14d.totalHours ?? 0) - totalHours;
    prevLaborPct = p7GrossSales > 0 ? (p7LaborCost / p7GrossSales) * 100 : null;
    prevSplh = p7Hours > 0 ? p7GrossSales / p7Hours : null;
    prevHours = p7Hours;
  }

  const topEmployees = [...employees].sort((a, b) => b.totalHours - a.totalHours).slice(0, topN);

  type M = { label: string; cur: string; prev: number | null; bad: boolean; unit: string; invertBad: boolean };
  const metrics: M[] = [
    { label: 'Labor %', cur: `${fmt(laborPct, 1)}%`, prev: prevLaborPct != null ? laborPct - prevLaborPct : null, bad: overTarget, unit: 'pp', invertBad: true },
    { label: 'SPLH',    cur: `$${fmt(splh, 2)}`,     prev: prevSplh != null ? splh - prevSplh : null,         bad: false, unit: '$', invertBad: false },
    { label: 'Hours',   cur: `${fmt(totalHours, 1)}h`, prev: prevHours != null ? totalHours - prevHours : null, bad: false, unit: 'h', invertBad: false },
  ];

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-3 gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg bg-muted/50 p-2 text-center">
            <p className={cn('text-base font-bold', m.bad ? 'text-red-600 dark:text-red-400' : '')}>{m.cur}</p>
            {m.prev != null && Math.abs(m.prev) >= 0.05 && (
              <p className={cn('text-[10px] flex items-center justify-center gap-0.5',
                (m.invertBad ? m.prev > 0 : m.prev < 0) ? 'text-red-500' : 'text-emerald-500')}>
                {m.prev > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                {Math.abs(m.prev).toFixed(m.label === 'Hours' ? 1 : 2)}{m.unit}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">{m.label}</p>
          </div>
        ))}
      </div>
      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Labor % vs {target}% target</span>
          <span className={overTarget ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400'}>
            {overTarget ? `+${fmt(laborPct - target, 1)}pp over` : 'On target'}
          </span>
        </div>
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full', overTarget ? 'bg-red-500' : laborPct > target * 0.9 ? 'bg-amber-400' : 'bg-emerald-500')}
            style={{ width: `${Math.min((laborPct / (target * 1.5)) * 100, 100)}%` }} />
        </div>
      </div>
      {topEmployees.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Hours this period</p>
          <div className="divide-y divide-border/50">
            {topEmployees.map((emp) => (
              <div key={emp.userId} className="flex items-center justify-between py-1 text-sm">
                <span className="text-muted-foreground">{emp.name}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-medium">{fmt(emp.totalHours, 1)}h</span>
                  <span className="text-muted-foreground">{fmtMoney(emp.laborCost)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Leaderboard — top/bottom N + category breakdown + 7d delta
// ─────────────────────────────────────────────────────────────────────────────
const CAT_KEYS = ['attendance', 'tasks', 'sops', 'engagement', 'learning'] as const;
const CAT_LABELS: Record<typeof CAT_KEYS[number], string> = { attendance: 'Att', tasks: 'Tasks', sops: 'SOPs', engagement: 'Eng', learning: 'Learn' };

function MiniCategoryBars({ breakdown }: { breakdown: GamificationScore['breakdown'] }) {
  if (!breakdown) return null;
  return (
    <div className="flex items-end gap-1 mt-0.5">
      {CAT_KEYS.map((key) => {
        const norm = Math.round(breakdown[key]?.normalized ?? 0);
        const color = norm >= 70 ? 'bg-emerald-400' : norm >= 40 ? 'bg-amber-400' : 'bg-red-400';
        return (
          <div key={key} className="flex flex-col items-center gap-0.5" title={`${CAT_LABELS[key]}: ${norm}`}>
            <div className="w-4 bg-muted rounded-sm overflow-hidden" style={{ height: 16 }}>
              <div className={cn('w-full rounded-sm', color)} style={{ height: `${norm}%`, marginTop: `${100 - norm}%` }} />
            </div>
            <span className="text-[7px] text-muted-foreground leading-none">{CAT_LABELS[key]}</span>
          </div>
        );
      })}
    </div>
  );
}

function PerformanceLeaderboardPanel({ scores, topN, scoreHistories, bronzeThreshold }: {
  scores: GamificationScore[];
  topN: number;
  scoreHistories: Map<string, Array<{ overallScore?: number }>>;
  bronzeThreshold: number;
}) {
  if (!scores.length) return <p className="text-sm text-muted-foreground pt-2">No performance data yet.</p>;
  const sorted = [...scores].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
  const top = sorted.slice(0, topN);
  const bottom = sorted.length > topN ? sorted.slice(-topN).reverse() : [];
  const getDelta = (uid: string): number | null => {
    const h = scoreHistories.get(uid);
    if (!h || h.length < 2) return null;
    return Math.round((h[h.length - 1]?.overallScore ?? 0) - (h[0]?.overallScore ?? 0));
  };
  const medals = ['🥇', '🥈', '🥉'];
  const Row = ({ entry, rank, isTop }: { entry: GamificationScore; rank: number; isTop: boolean }) => {
    const name = `${entry.firstName ?? ''} ${entry.lastName ?? ''}`.trim() || 'Employee';
    const score = Math.round(entry.overallScore ?? 0);
    const below = score < bronzeThreshold;
    const delta = getDelta(entry.userId);
    return (
      <div className="flex items-start justify-between py-2 text-sm">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold w-5 text-center shrink-0">{isTop ? (medals[rank - 1] ?? `#${rank}`) : `↓${rank}`}</span>
            <span className="font-medium">{name}</span>
            {entry.tier && <Badge variant="outline" className={cn('text-xs px-1', below ? 'border-red-300 text-red-600 dark:text-red-400' : '')}>{entry.tier}</Badge>}
            {delta !== null && Math.abs(delta) >= 5 && (
              <span className={cn('text-xs flex items-center gap-0.5', delta > 0 ? 'text-emerald-500' : 'text-red-500')}>
                {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{Math.abs(delta)}
              </span>
            )}
          </div>
          <div className="ml-7"><MiniCategoryBars breakdown={entry.breakdown} /></div>
        </div>
        <span className={cn('font-bold text-base shrink-0', isTop ? 'text-amber-600 dark:text-amber-400' : below ? 'text-red-500' : 'text-muted-foreground')}>{score}</span>
      </div>
    );
  };
  return (
    <div className="pt-1 space-y-2">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Top {topN}</p>
        <div className="divide-y divide-border/50">{top.map((e, i) => <Row key={e.userId} entry={e} rank={i + 1} isTop />)}</div>
      </div>
      {bottom.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Needs Support</p>
          <div className="divide-y divide-border/50">{bottom.map((e, i) => <Row key={e.userId} entry={e} rank={i + 1} isTop={false} />)}</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HR Actions
// Tardiness: clock-events `late-clock-in` / `excessive-late` in pay period
// No-shows: shift ENDED with no time entry at all
// Kudos: top performers (above-median score) without kudos in 14d
// ─────────────────────────────────────────────────────────────────────────────
type HRType = 'tardiness' | 'no-show' | 'below-bronze' | 'kudos-needed';
interface HRAction { type: HRType; name: string; detail: string; priority: 1 | 2 | 3 }

function HRActionsPanel({ actions }: { actions: HRAction[] }) {
  if (!actions.length) return (
    <div className="flex items-center gap-2 pt-2 text-sm text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4" />No HR actions needed today.
    </div>
  );
  const iconMap: Record<HRType, React.ReactNode> = {
    'no-show':     <AlertTriangle className="h-4 w-4 text-red-500" />,
    tardiness:     <Clock className="h-4 w-4 text-amber-500" />,
    'below-bronze':<TrendingDown className="h-4 w-4 text-orange-500" />,
    'kudos-needed':<Star className="h-4 w-4 text-purple-500" />,
  };
  return (
    <div className="divide-y divide-border/50 pt-2">
      {[...actions].sort((a, b) => a.priority - b.priority).map((a, i) => (
        <div key={i} className="flex items-start gap-2 py-1.5 text-sm">
          <span className="mt-0.5 shrink-0">{iconMap[a.type]}</span>
          <div>
            <span className="font-medium">{a.name}</span>
            <span className="text-muted-foreground ml-1.5 text-xs">{a.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks Health
// ─────────────────────────────────────────────────────────────────────────────
function TasksHealthPanel({ tasks }: { tasks: Task[] }) {
  const now = new Date();
  const open      = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const overdue   = open.filter((t) => t.dueDate && new Date(t.dueDate) < startOfDay(now));
  const unassigned = open.filter((t) => !t.assignedTo);
  const inProg    = tasks.filter((t) => t.status === 'in_progress');
  const doneToday = tasks.filter((t) => t.status === 'completed' && t.updatedAt && new Date(t.updatedAt) >= startOfDay(now));
  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Overdue',     v: overdue.length,    color: overdue.length > 0 ? 'text-red-600 dark:text-red-400' : '' },
          { label: 'In Progress', v: inProg.length,     color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Done Today',  v: doneToday.length,  color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Unassigned',  v: unassigned.length, color: unassigned.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-muted/50 p-2 text-center">
            <p className={cn('text-xl font-bold', s.color)}>{s.v}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      {overdue.length > 0 && (
        <div className="text-xs space-y-0.5">
          <p className="font-semibold text-red-600 dark:text-red-400">Overdue:</p>
          {overdue.slice(0, 4).map((t) => (
            <p key={t.id} className="text-muted-foreground">
              • {t.title}
              <span className="opacity-60 ml-1">({ageLabel(t.dueDate)})</span>
            </p>
          ))}
          {overdue.length > 4 && <p className="text-muted-foreground">+{overdue.length - 4} more overdue</p>}
        </div>
      )}
      {unassigned.length > 0 && (
        <div className="text-xs space-y-0.5">
          <p className="font-semibold text-amber-600 dark:text-amber-400">Unassigned ({unassigned.length}):</p>
          {unassigned.slice(0, 3).map((t) => (
            <p key={t.id} className="text-muted-foreground">• {t.title}</p>
          ))}
          {unassigned.length > 3 && <p className="text-muted-foreground">+{unassigned.length - 3} more unassigned</p>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplies
// ─────────────────────────────────────────────────────────────────────────────
function SuppliesReorderPanel({ items, tasks, onTaskCreated }: {
  items: SupplyItem[];
  tasks: Task[];
  onTaskCreated?: () => void;
}) {
  const needsReorder = items.filter((i) => i.stockStatus === 'low' || i.stockStatus === 'critical' || i.stockStatus === 'empty');
  const hasTask = (item: SupplyItem) =>
    !!(item.pendingReorderTaskId || item.reorderTaskId) ||
    tasks.some((t) => t.status !== 'completed' && t.status !== 'cancelled' &&
      ((t.title ?? '').toLowerCase().includes((item.name ?? '').toLowerCase()) || t.supplyItemId === item.id));

  const { mutate: createTask, isPending: creating, variables: creating_for } = useMutation({
    mutationFn: async (item: SupplyItem) => {
      const r = await apiRequest('POST', '/api/tasks', {
        title: `Reorder supply: ${item.name}`,
        description: `Stock level is ${item.stockStatus}. Please reorder ${item.name} immediately.`,
        priority: item.stockStatus === 'empty' || item.stockStatus === 'critical' ? 'high' : 'medium',
        category: 'supply',
        supplyItemId: item.id,
      });
      return r.json();
    },
    onSuccess: () => { onTaskCreated?.(); },
  });

  if (!needsReorder.length) return (
    <div className="flex items-center gap-2 pt-2 text-sm text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4" />All supplies are well-stocked.
    </div>
  );
  return (
    <div className="divide-y divide-border/50 pt-2">
      {needsReorder.slice(0, 8).map((item) => {
        const taskExists = hasTask(item);
        const isCreating = creating && (creating_for as SupplyItem | undefined)?.id === item.id;
        return (
          <div key={item.id} className="flex items-center justify-between py-1.5 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{item.name}</span>
              {taskExists
                ? <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 dark:text-blue-400">Task open</Badge>
                : (
                  <Button variant="outline" size="sm" className="h-5 px-2 text-xs border-orange-300 text-orange-600 dark:text-orange-400"
                    disabled={isCreating}
                    onClick={() => createTask(item)}>
                    {isCreating ? 'Creating…' : '+ Create task'}
                  </Button>
                )}
            </div>
            <Badge variant={item.stockStatus === 'empty' || item.stockStatus === 'critical' ? 'destructive' : 'outline'} className="text-xs capitalize">
              {item.stockStatus}
            </Badge>
          </div>
        );
      })}
      {needsReorder.length > 8 && <p className="text-xs text-muted-foreground pt-1">+{needsReorder.length - 8} more</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Issues Snapshot
// ─────────────────────────────────────────────────────────────────────────────
function IssuesSnapshotPanel({ issues }: { issues: Issue[] }) {
  const sev = (i: Issue) => (i.severity ?? i.priority ?? 'medium').toLowerCase();
  const critical = issues.filter((i) => ['critical', 'urgent'].includes(sev(i)));
  const high     = issues.filter((i) => sev(i) === 'high');
  const other    = issues.filter((i) => !['critical', 'urgent', 'high'].includes(sev(i)));
  if (!issues.length) return (
    <div className="flex items-center gap-2 pt-2 text-sm text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4" />No open issues.
    </div>
  );
  const topIssues = [...critical, ...high];
  return (
    <div className="space-y-2 pt-2">
      <div className="grid grid-cols-3 gap-2">
        {[{ label: 'Critical/Urgent', count: critical.length, color: 'text-red-600 dark:text-red-400' },
          { label: 'High',            count: high.length,     color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Other',           count: other.length,    color: 'text-blue-600 dark:text-blue-400' }].map((s) => (
          <div key={s.label} className="rounded-lg bg-muted/50 p-2 text-center">
            <p className={cn('text-xl font-bold', s.color)}>{s.count}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
          </div>
        ))}
      </div>
      {topIssues.length > 0 && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {topIssues.slice(0, 5).map((issue) => (
            <div key={issue.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate">
                  <span className={cn('font-semibold mr-1', critical.includes(issue) ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                    [{sev(issue).toUpperCase()}]
                  </span>
                  {issue.title ?? issue.description?.slice(0, 60) ?? 'Untitled'}
                </p>
                {(issue.assignedToName ?? issue.assignedTo) && (
                  <p className="text-muted-foreground/60 text-[10px]">
                    Assigned: {issue.assignedToName ?? issue.assignedTo}
                  </p>
                )}
              </div>
              <span className="shrink-0 opacity-60">{ageLabel(issue.createdAt)}</span>
            </div>
          ))}
          {issues.length > 5 && <p>+{issues.length - 5} more open issues</p>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upcoming Shifts
//  Section A: All remaining shifts today — not-yet-started + started-but-absent
//    • red   = shift started, employee never clocked in (no-show)
//    • amber = shift starts within 30 min, employee not yet in
//    • gray  = upcoming (>30 min away)
//    Employees already clocked in for the shift are excluded (floor status covers them)
//  Section B: Upcoming This Week strip (compact day coverage)
// ─────────────────────────────────────────────────────────────────────────────
type ShiftStatus = 'no-show' | 'starting-soon' | 'later-today';

function UpcomingShiftsPanel({ todaySchedules, weekSchedules, users, timeEntries, locations, scheduleGenerationDays, huddleStatus }: {
  todaySchedules: Schedule[];
  weekSchedules: Schedule[];
  users: User[];
  timeEntries: TimeEntry[];
  locations: WorkLocation[];
  scheduleGenerationDays: number;
  huddleStatus: string | null;
}) {
  const now = new Date();
  const userMap = new Map(users.map((u) => [u.id, u]));
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  const clockedInUids = new Set(timeEntries.filter((e) => !e.clockOutTime).map((e) => e.userId));

  // Section A: remaining shifts (not yet ended) where the employee has NOT clocked in
  // Includes: already-started shifts (no-show) + upcoming shifts
  const pending = todaySchedules
    .filter((s) => {
      if (new Date(s.endTime) <= now) return false;   // shift fully over — omit
      if (clockedInUids.has(s.userId)) return false;  // employee is in — floor status covers
      return true;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  // Section B: next 7 days fixed strip (7-day window: today + next 7)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(now, i + 1);
    const count = weekSchedules.filter((s) => isSameDay(new Date(s.startTime), day)).length;
    return { day, count };
  });

  function getStatus(s: Schedule): ShiftStatus {
    const start = new Date(s.startTime);
    if (start <= now) return 'no-show';                               // started, not in
    if (differenceInMinutes(start, now) <= 30) return 'starting-soon'; // within 30 min
    return 'later-today';
  }

  const statusColor: Record<ShiftStatus, string> = {
    'no-show':       'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700',
    'starting-soon': 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700',
    'later-today':   'bg-background border-border',
  };
  const statusText: Record<ShiftStatus, string> = {
    'no-show':       'No-show',
    'starting-soon': 'Starting soon',
    'later-today':   'Upcoming',
  };
  const statusTextColor: Record<ShiftStatus, string> = {
    'no-show':       'text-red-600 dark:text-red-400',
    'starting-soon': 'text-amber-600 dark:text-amber-400',
    'later-today':   'text-muted-foreground',
  };

  const noShowCount = pending.filter((s) => getStatus(s) === 'no-show').length;

  return (
    <div className="space-y-4 pt-2">
      {/* Section A */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Today's remaining shifts — not clocked in ({pending.length})
          {noShowCount > 0 && <span className="text-red-600 dark:text-red-400 ml-1">· {noShowCount} no-show{noShowCount !== 1 ? 's' : ''}</span>}
        </p>
        {pending.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">All scheduled employees are already clocked in, or no shifts remain.</p>
        ) : (
          <div className="space-y-1">
            {pending.map((s) => {
              const u = userMap.get(s.userId);
              const st = getStatus(s);
              return (
                <div key={s.id} className={cn('flex items-center justify-between px-2 py-1.5 rounded-md border text-sm', statusColor[st])}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{u ? uName(u) : 'Employee'}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(s.startTime), 'h:mma')}–{format(new Date(s.endTime), 'h:mma')}
                    </span>
                    {s.locationId && (
                      <span className="text-xs text-muted-foreground/70 flex items-center gap-0.5">
                        <MapPin className="h-2.5 w-2.5" />{locMap.get(s.locationId) ?? s.locationId}
                      </span>
                    )}
                  </div>
                  <span className={cn('text-xs font-medium shrink-0', statusTextColor[st])}>
                    {statusText[st]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section B: Upcoming This Week strip */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Upcoming This Week
        </p>
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map(({ day, count }, i) => {
            // Days within the scheduleGenerationDays warning window get publish-health coloring
            // Days beyond the window are neutral gray (not expected to be scheduled yet)
            const daysFromToday = i + 1;
            const withinWindow = daysFromToday <= scheduleGenerationDays;
            const cls = !withinWindow
              ? 'bg-muted/40 border-border text-muted-foreground'
              : count === 0
                ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700'
                : count <= 2
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700';
            return (
            <div key={day.toISOString()}
              className={cn('flex flex-col items-center justify-center rounded-md border py-1.5 text-center', cls)}>
              <span className="text-[10px] font-semibold uppercase opacity-70">{format(day, 'EEE')}</span>
              <span className="text-sm font-bold">{count}</span>
              <span className="text-[8px] opacity-60">{format(day, 'M/d')}</span>
            </div>
            );
          })}
        </div>
        {weekDays.filter((d) => d.count === 0).length > 0 && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            ⚠ {weekDays.filter((d) => d.count === 0).length} day{weekDays.filter((d) => d.count === 0).length !== 1 ? 's' : ''} with no coverage planned
          </p>
        )}
      </div>

      {/* Huddle badge */}
      {huddleStatus && (
        <div className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
          huddleStatus === 'completed'
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300')}>
          <Sun className="h-3.5 w-3.5 shrink-0" />
          Morning Huddle: {huddleStatus === 'completed' ? 'Complete ✓' : huddleStatus === 'in_progress' ? 'In Progress' : 'Not Started'}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminOwnerDashboard — main component
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminOwnerDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [, navigate] = useLocation();
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const today  = todayStr();
  const ago14d = daysAgoStr(14);
  const in7d   = addDays(new Date(), 7).toISOString().split('T')[0];

  // ── Settings ──────────────────────────────────────────────────────────────
  const { data: settings } = useQuery<Record<string, unknown>>({
    queryKey: ['/api/company-settings'],
    staleTime: 5 * 60_000,
  });
  const topN: number                = (settings?.dashboardTopBottomN as number) ?? 3;
  const lateCountThreshold: number  = (settings?.lateClockInAlertThreshold as number) ?? 2;
  const lateThresholdMin: number    = (settings?.lateThresholdMinutes as number) ?? 5;
  const schedGenDays: number        = (settings?.scheduleGenerationDays as number) ?? 5;
  const bronzeThreshold             = 40;

  // ── Queries ───────────────────────────────────────────────────────────────
  async function fetchArr<T>(url: string): Promise<T[]> {
    const r = await apiRequest('GET', url);
    const j = await r.json();
    return Array.isArray(j) ? j : (j.data ?? j.schedules ?? j.items ?? j.users ?? j.scores ?? []);
  }

  const entriesQ = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries', 'today'],
    queryFn: () => fetchArr<TimeEntry>(`/api/time-entries?startDate=${today}&endDate=${today}`),
    staleTime: 15_000, refetchInterval: 30_000,
  });
  const todayEntries = entriesQ.data ?? [];

  const usersQ = useQuery<User[]>({
    queryKey: ['/api/users'],
    queryFn: () => fetchArr<User>('/api/users'),
    staleTime: 5 * 60_000,
  });
  const users = usersQ.data ?? [];

  const schedQ = useQuery<Schedule[]>({
    queryKey: ['/api/schedules', 'today'],
    queryFn: () => fetchArr<Schedule>(`/api/schedules?startDate=${today}&endDate=${today}`),
    staleTime: 15_000, refetchInterval: 30_000,
  });
  const todaySchedules = schedQ.data ?? [];

  const weekSchedQ = useQuery<Schedule[]>({
    queryKey: ['/api/schedules', 'week'],
    queryFn: () => fetchArr<Schedule>(`/api/schedules?startDate=${today}&endDate=${in7d}`),
    staleTime: 5 * 60_000, refetchInterval: 30_000,
  });
  const weekSchedules = weekSchedQ.data ?? [];

  const locQ = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
    queryFn: () => fetchArr<WorkLocation>('/api/work-locations'),
    staleTime: 10 * 60_000,
  });
  const locations = locQ.data ?? [];

  const offsiteQ = useQuery<OffsiteSession[]>({
    queryKey: ['/api/offsite-sessions', 'active'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/offsite-sessions/active');
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : (j.data ?? []);
    },
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const offsiteSessions = offsiteQ.data ?? [];

  const goalQ = useQuery<DailyGoal | null>({
    queryKey: ['/api/dashboard/daily-goal'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/dashboard/daily-goal');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 30_000, refetchInterval: 60_000,
  });

  const payQ = useQuery<PayrollSummary | null>({
    queryKey: ['/api/payroll-intelligence/summary', 7],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/payroll-intelligence/summary?daysBack=7');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 5 * 60_000, refetchInterval: 300_000,
  });

  const pay14Q = useQuery<PayrollSummary | null>({
    queryKey: ['/api/payroll-intelligence/summary', 14],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/payroll-intelligence/summary?daysBack=14');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 5 * 60_000, refetchInterval: 300_000,
  });

  const perfQ = useQuery<GamificationScore[]>({
    queryKey: ['/api/gamification/team-scores'],
    queryFn: () => fetchArr<GamificationScore>('/api/gamification/team-scores'),
    staleTime: 5 * 60_000, refetchInterval: 300_000,
  });
  const gamificationScores = perfQ.data ?? [];

  const tasksQ = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
    queryFn: () => fetchArr<Task>('/api/tasks'),
    staleTime: 60_000, refetchInterval: 2 * 60_000,
  });
  const tasks = tasksQ.data ?? [];

  const suppliesQ = useQuery<SupplyItem[]>({
    queryKey: ['/api/supply/items'],
    queryFn: () => fetchArr<SupplyItem>('/api/supply/items'),
    staleTime: 2 * 60_000, refetchInterval: 120_000,
  });
  const supplyItems = suppliesQ.data ?? [];

  const issuesQ = useQuery<unknown>({
    queryKey: ['/api/issues', 'open'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/issues?status=open');
      return r.json();
    },
    staleTime: 60_000, refetchInterval: 2 * 60_000,
  });
  const issues: Issue[] = Array.isArray(issuesQ.data) ? issuesQ.data : ((issuesQ.data as { data?: Issue[] } | null)?.data ?? []);

  const clockEventsQ = useQuery<ClockEvent[]>({
    queryKey: ['/api/clock-events', 'pay-period'],
    queryFn: () => fetchArr<ClockEvent>(`/api/clock-events?startDate=${ago14d}&endDate=${today}`),
    staleTime: 5 * 60_000,
  });
  const clockEvents = clockEventsQ.data ?? [];

  const kudosQ = useQuery<Kudo[]>({
    queryKey: ['/api/kudos', '14d'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/kudos');
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j) ? j : (j.data ?? []);
    },
    staleTime: 5 * 60_000,
  });
  const recentKudos = kudosQ.data ?? [];

  const huddleQ = useQuery<unknown>({
    queryKey: ['/api/rituals/huddle/today'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/rituals/huddle/today');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const huddleStatus: string | null = (huddleQ.data as { data?: { status?: string } } | null)?.data?.status ?? null;

  // Score histories — bounded to top N + bottom N only
  const sortedScores = [...gamificationScores].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
  const topNArr    = sortedScores.slice(0, topN);
  const bottomNArr = sortedScores.length > topN ? sortedScores.slice(-topN) : [];
  const boundedIds = [...new Set([...topNArr, ...bottomNArr].map((e) => e.userId).filter(Boolean))];

  const historyQueries = useQueries({
    queries: boundedIds.map((uid) => ({
      queryKey: ['/api/gamification/score-history', uid, '7d'],
      queryFn: async (): Promise<Array<{ overallScore?: number }>> => {
        const r = await apiRequest('GET', `/api/gamification/score-history?userId=${uid}&range=7d`);
        if (!r.ok) return [];
        const j = await r.json();
        return Array.isArray(j) ? j : (j.data ?? []);
      },
      staleTime: 5 * 60_000,
      enabled: boundedIds.length > 0,
    })),
  });
  const scoreHistories = new Map<string, Array<{ overallScore?: number }>>();
  boundedIds.forEach((uid, i) => { scoreHistories.set(uid, historyQueries[i]?.data ?? []); });

  // ── Derived state ─────────────────────────────────────────────────────────
  const now = currentTime;
  const userMap = new Map(users.map((u) => [u.id, u]));

  const activeEntries = todayEntries.filter((e) => !e.clockOutTime);
  const activeCount   = activeEntries.length;
  const scheduledCount = todaySchedules.length;

  // Floor-status no-shows: shift started, not clocked in (real-time for floor display)
  const floorNoShows = todaySchedules.filter((s) =>
    new Date(s.startTime) <= now && !todayEntries.some((e) => e.userId === s.userId)
  );

  // HR no-shows: shift has ENDED + never clocked in today
  const hrNoShows = todaySchedules.filter((s) =>
    new Date(s.endTime) < now && !todayEntries.some((e) => e.userId === s.userId)
  );

  // Late arrivals today (for briefing)
  const lateSinceOpen = activeEntries.filter((e) => {
    const sched = todaySchedules.find((s) => s.userId === e.userId);
    if (!sched) return false;
    return differenceInMinutes(new Date(e.clockInTime), new Date(sched.startTime)) > lateThresholdMin;
  }).length;

  // Tardiness via clock-events
  const lateCountByUser = new Map<string, number>();
  for (const ev of clockEvents) {
    if (ev.eventType === 'late-clock-in' || ev.eventType === 'excessive-late') {
      lateCountByUser.set(ev.userId, (lateCountByUser.get(ev.userId) ?? 0) + 1);
    }
  }
  const tardyEmployees = [...lateCountByUser.entries()]
    .filter(([, count]) => count >= lateCountThreshold)
    .map(([uid, count]) => ({ uid, count, u: userMap.get(uid) }));

  // Below-bronze
  const belowBronze = sortedScores.filter((e) => (e.overallScore ?? 0) < bronzeThreshold);

  // Kudos: top performers (above median score) without kudos in 14d
  const cutoff14d = now.getTime() - 14 * 86400000;
  const recentKudoRecipients = new Set(
    recentKudos.filter((k) => k.createdAt && new Date(k.createdAt).getTime() >= cutoff14d)
      .map((k) => k.toEmployeeId).filter((id): id is string => !!id)
  );
  const medianScore = sortedScores.length > 0 ? (sortedScores[Math.floor(sortedScores.length / 2)]?.overallScore ?? 0) : 50;
  const topPerformersNeedingKudos = sortedScores.filter((s) =>
    (s.overallScore ?? 0) >= medianScore && !recentKudoRecipients.has(s.userId)
  ).slice(0, 3);

  // HR Actions
  const hrActions: HRAction[] = [];
  hrNoShows.slice(0, 4).forEach((s) => {
    const u = userMap.get(s.userId);
    hrActions.push({ type: 'no-show', name: u ? uName(u) : 'Employee',
      detail: `Shift ended ${format(new Date(s.endTime), 'h:mma')} — never clocked in`, priority: 1 });
  });
  tardyEmployees.slice(0, 4).forEach(({ u, count }) => {
    hrActions.push({ type: 'tardiness', name: u ? uName(u) : 'Employee',
      detail: `${count} late arrival${count !== 1 ? 's' : ''} this pay period (threshold: ${lateCountThreshold})`, priority: 2 });
  });
  belowBronze.slice(0, 3).forEach((e) => {
    hrActions.push({ type: 'below-bronze',
      name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Employee',
      detail: `Score ${Math.round(e.overallScore ?? 0)} — below Bronze (${bronzeThreshold})`, priority: 2 });
  });
  if (topPerformersNeedingKudos.length > 0) {
    hrActions.push({ type: 'kudos-needed',
      name: topPerformersNeedingKudos.slice(0, 2).map((e) => e.firstName ?? 'Employee').join(', ')
        + (topPerformersNeedingKudos.length > 2 ? ` +${topPerformersNeedingKudos.length - 2}` : ''),
      detail: 'Top performers without kudos in 14+ days', priority: 3 });
  }

  // Payroll
  const laborPct       = payQ.data?.laborPct ?? null;
  const splh           = payQ.data?.splh ?? null;
  const payrollTarget  = payQ.data?.settings?.payrollTargetPct ?? 30;
  const overTarget     = laborPct != null && laborPct > payrollTarget;
  const payrollHealthPct = laborPct != null ? Math.round((laborPct / payrollTarget) * 100) : null;

  // Location mismatches: active time-entry.locationId ≠ scheduled locationId
  const locationMismatchCount = activeEntries.filter((e) => {
    const sched = todaySchedules.find((s) => s.userId === e.userId);
    return sched?.locationId && e.locationId && e.locationId !== sched.locationId;
  }).length;

  // Supplies without task
  const reorderItems = supplyItems.filter((i) => i.stockStatus === 'low' || i.stockStatus === 'critical' || i.stockStatus === 'empty');
  const reorderWithoutTask = reorderItems.filter((item) =>
    !(item.pendingReorderTaskId || item.reorderTaskId) &&
    !tasks.some((t) => t.status !== 'completed' && t.status !== 'cancelled' &&
      ((t.title ?? '').toLowerCase().includes((item.name ?? '').toLowerCase()) || t.supplyItemId === item.id))
  );

  const overdueTaskCount = tasks.filter((t) =>
    t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate && new Date(t.dueDate) < startOfDay(now)
  ).length;

  const urgentHighIssues = issues.filter((i) => ['critical', 'urgent', 'high'].includes((i.severity ?? i.priority ?? '').toLowerCase()));

  // Shifts starting within 30 min with no one clocked in at that location
  const unstaffedSoon = todaySchedules.filter((s) => {
    const minsTo = differenceInMinutes(new Date(s.startTime), now);
    if (minsTo < 0 || minsTo > 30) return false;
    const locId = s.locationId ?? null;
    return !activeEntries.some((e) => {
      const es = todaySchedules.find((sc) => sc.userId === e.userId);
      return (es?.locationId ?? null) === locId;
    });
  }).length;

  // Schedule gaps in next schedGenDays days
  const missingScheduleDays = Array.from({ length: schedGenDays }, (_, i) => {
    const day = addDays(now, i + 1);
    return weekSchedules.some((s) => isSameDay(new Date(s.startTime), day));
  }).filter((has) => !has).length;

  // Top performer name
  const topPerformerName = sortedScores[0]
    ? `${sortedScores[0].firstName ?? ''} ${sortedScores[0].lastName ?? ''}`.trim() || null
    : null;

  // Sales vs goal
  // Use server-computed progress field, fallback to computing from goal/current
  const salesVsGoalPct = goalQ.data?.hasGoal
    ? (goalQ.data.progress ?? (
        (goalQ.data.goal?.revenue ?? 0) > 0
          ? Math.round(((goalQ.data.current?.revenue ?? 0) / goalQ.data.goal!.revenue!) * 100)
          : null
      ))
    : null;
  const openTaskCount = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;

  // ── Action Required — ordered by operational urgency ─────────────────────
  const actionItems: ActionItem[] = [
    { label: 'unstaffed in <30min',     count: unstaffedSoon,            colorClass: C_RED,    panelId: 'aod-floor',       urgency: 1 },
    { label: 'location mismatches',     count: locationMismatchCount,    colorClass: C_RED,    panelId: 'aod-floor',       urgency: 2 },
    { label: 'no-shows',                count: floorNoShows.length,      colorClass: C_RED,    panelId: 'aod-floor',       urgency: 3 },
    { label: 'urgent/high issues',      count: urgentHighIssues.length,  colorClass: C_RED,    panelId: 'aod-issues',      urgency: 4 },
    { label: 'payroll over target',     count: overTarget ? 1 : 0,       colorClass: C_RED,    panelId: 'aod-payroll',     urgency: 5 },
    { label: 'HR actions',              count: hrActions.filter((a) => a.priority <= 2).length, colorClass: C_ORANGE, panelId: 'aod-hr', urgency: 6 },
    { label: 'schedule gaps',           count: missingScheduleDays,      colorClass: C_AMBER,  panelId: 'aod-schedule',    urgency: 7 },
    { label: 'overdue tasks',           count: overdueTaskCount,         colorClass: C_AMBER,  panelId: 'aod-tasks',       urgency: 8 },
    { label: 'supplies without task',   count: reorderWithoutTask.length, colorClass: C_AMBER, panelId: 'aod-supplies',    urgency: 9 },
    { label: 'below-bronze employees',  count: belowBronze.length,       colorClass: C_ORANGE, panelId: 'aod-performance', urgency: 10 },
  ];

  // ── Accents ───────────────────────────────────────────────────────────────
  const payrollAccent: DashboardCardProps['accent'] = overTarget ? 'critical' : laborPct != null && laborPct > payrollTarget * 0.9 ? 'warning' : 'default';

  // ── Loading ───────────────────────────────────────────────────────────────
  if (entriesQ.isLoading || usersQ.isLoading || schedQ.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-500" />
            {format(now, 'EEEE, MMMM d')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Business Health Monitor · {format(now, 'h:mm a')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/settings?section=dashboard')}>Settings</Button>
      </div>

      {/* Action Required */}
      <DashboardErrorBoundary fallback="Could not load action items">
        <ActionRequiredStrip items={actionItems} />
      </DashboardErrorBoundary>

      {/* 1. AI Morning Briefing */}
      <DashboardErrorBoundary fallback="AI briefing unavailable">
        <DashboardCard title="AI Morning Briefing" icon={<Bot className="h-4 w-4" />}
          storageKey="ai-briefing" panelId="aod-briefing" defaultExpanded
          updatedAt={entriesQ.dataUpdatedAt}
          summaryRow={<span>{activeCount} on floor · {scheduledCount} scheduled{salesVsGoalPct != null && ` · ${salesVsGoalPct}% of goal`}</span>}>
          <AIBriefingPanel activeCount={activeCount} scheduledCount={scheduledCount}
            lateSinceOpen={lateSinceOpen} salesVsGoalPct={salesVsGoalPct}
            openIssues={issues.length} openTasks={openTaskCount}
            payrollHealthPct={payrollHealthPct} topPerformer={topPerformerName}
            dayOfWeek={format(now, 'EEEE')} />
        </DashboardCard>
      </DashboardErrorBoundary>

      {/* 2. Floor Status */}
      <DashboardErrorBoundary fallback="Floor status unavailable">
        <DashboardCard title="Floor Status" icon={<Users className="h-4 w-4" />}
          storageKey="floor-status" panelId="aod-floor" defaultExpanded navigateTo="/time"
          accent={floorNoShows.length > 0 || unstaffedSoon > 0 ? 'critical' : 'default'}
          updatedAt={entriesQ.dataUpdatedAt}
          summaryRow={<span>
            {activeCount} on floor · {locations.filter((l) => l.isActive !== false).length} location{locations.filter((l) => l.isActive !== false).length !== 1 ? 's' : ''} · {activeEntries.filter((e) => !!e.breakStartTime).length} on break
            {floorNoShows.length > 0 && <span className="text-red-600 dark:text-red-400 ml-1">· {floorNoShows.length} no-show{floorNoShows.length !== 1 ? 's' : ''}</span>}
            {locationMismatchCount > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 border-orange-300 text-orange-600 dark:text-orange-400">⚠ {locationMismatchCount} mismatch{locationMismatchCount !== 1 ? 'es' : ''}</Badge>}
          </span>}>
          <FloorStatusPanel timeEntries={todayEntries} todaySchedules={todaySchedules}
            users={users} locations={locations} offsiteSessions={offsiteSessions}
            lateThresholdMinutes={lateThresholdMin} />
        </DashboardCard>
      </DashboardErrorBoundary>

      {/* 2b. Off-Site (conditional — shown when active sessions or schedule keywords match) */}
      {(() => {
        const activeSessions = offsiteSessions.filter((s) => s.status === 'active');
        // Also detect employees with a scheduled shift whose location name contains offsite keywords
        const OFFSITE_KEYWORDS = /offsite|off-site|trip|event|training|conference|errand/i;
        const scheduleOffsite = todaySchedules.filter((s) => {
          const loc = locations.find((l) => l.id === s.locationId);
          return loc && OFFSITE_KEYWORDS.test(loc.name);
        });
        const hasAny = activeSessions.length > 0 || scheduleOffsite.length > 0;
        if (!hasAny) return null;
        const totalCount = activeSessions.length + scheduleOffsite.filter((s) =>
          !activeSessions.some((a) => a.userId === s.userId)
        ).length;
        return (
          <DashboardErrorBoundary fallback="Off-site data unavailable">
            <DashboardCard title="Off-Site Activity" icon={<Navigation className="h-4 w-4" />}
              storageKey="offsite" panelId="aod-offsite" defaultExpanded
              updatedAt={offsiteQ.dataUpdatedAt}
              summaryRow={<span>{totalCount} employee{totalCount !== 1 ? 's' : ''} off-site</span>}>
              <div className="divide-y divide-border/50 pt-2">
                {activeSessions.map((session) => {
                  const u = users.find((usr) => usr.id === session.userId);
                  return (
                    <div key={`session-${session.id ?? session.userId}`} className="flex items-center justify-between py-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <Navigation className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        <span className="font-medium">{u ? uName(u) : 'Employee'}</span>
                      </div>
                      <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 dark:text-blue-400">
                        {session.destinationName ?? 'Off-site'}
                      </Badge>
                    </div>
                  );
                })}
                {scheduleOffsite.filter((s) => !activeSessions.some((a) => a.userId === s.userId)).map((sched) => {
                  const u = userMap.get(sched.userId);
                  const loc = locations.find((l) => l.id === sched.locationId);
                  return (
                    <div key={`sched-${sched.id}`} className="flex items-center justify-between py-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <Navigation className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-muted-foreground">{u ? uName(u) : 'Employee'}</span>
                      </div>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {loc?.name ?? 'Offsite location'} (scheduled)
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </DashboardCard>
          </DashboardErrorBoundary>
        );
      })()}

      {/* 3+4. Sales and Payroll */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DashboardErrorBoundary fallback="Sales data unavailable">
          <DashboardCard title="Sales vs. Goal" icon={<DollarSign className="h-4 w-4" />}
            storageKey="sales-goal" panelId="aod-sales" defaultExpanded navigateTo="/analytics"
            updatedAt={goalQ.dataUpdatedAt}
            accent={salesVsGoalPct == null ? 'default' : salesVsGoalPct >= 100 ? 'success' : salesVsGoalPct >= 70 ? 'default' : 'warning'}
            summaryRow={salesVsGoalPct != null ? <span>{salesVsGoalPct}% of daily goal</span> : <span>No sales data</span>}>
            <SalesGoalPanel dailyGoal={goalQ.data} />
          </DashboardCard>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Payroll data unavailable">
          <DashboardCard title="Payroll Health" icon={<BarChart3 className="h-4 w-4" />}
            storageKey="payroll-health" panelId="aod-payroll" navigateTo="/timesheets"
            accent={payrollAccent} updatedAt={payQ.dataUpdatedAt}
            summaryRow={payQ.data?.shopConnected
              ? <span>{fmt(laborPct, 1)}% labor · SPLH ${fmt(splh, 2)}{overTarget && ' ⚠ over target'}</span>
              : <span>Shopify not connected</span>}>
            <PayrollHealthPanel summary={payQ.data} prev14d={pay14Q.data} topN={topN} />
          </DashboardCard>
        </DashboardErrorBoundary>
      </div>

      {/* 5. Performance */}
      <DashboardErrorBoundary fallback="Performance data unavailable">
        <DashboardCard title="Performance Leaderboard" icon={<Trophy className="h-4 w-4" />}
          storageKey="performance" panelId="aod-performance" navigateTo="/gamification"
          accent={belowBronze.length > 0 ? 'warning' : 'default'} updatedAt={perfQ.dataUpdatedAt}
          summaryRow={<span>{gamificationScores.length} employees · Top &amp; bottom {topN}{belowBronze.length > 0 && ` · ${belowBronze.length} below Bronze`}</span>}>
          <PerformanceLeaderboardPanel scores={gamificationScores} topN={topN}
            scoreHistories={scoreHistories} bronzeThreshold={bronzeThreshold} />
        </DashboardCard>
      </DashboardErrorBoundary>

      {/* 6+7. HR and Tasks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DashboardErrorBoundary fallback="HR actions unavailable">
          <DashboardCard title="HR Actions" icon={<UserCheck className="h-4 w-4" />}
            storageKey="hr-actions" panelId="aod-hr" navigateTo="/time"
            defaultExpanded={hrActions.length > 0} updatedAt={clockEventsQ.dataUpdatedAt}
            accent={hrActions.some((a) => a.priority === 1) ? 'critical' : hrActions.length > 0 ? 'warning' : 'default'}
            summaryRow={<span>{hrActions.length === 0 ? 'No actions needed' : `${hrActions.length} action${hrActions.length !== 1 ? 's' : ''} needed`}</span>}>
            <HRActionsPanel actions={hrActions} />
          </DashboardCard>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Task data unavailable">
          <DashboardCard title="Tasks Health" icon={<CheckSquare className="h-4 w-4" />}
            storageKey="tasks-health" panelId="aod-tasks" navigateTo="/tasks"
            accent={overdueTaskCount > 0 ? 'warning' : 'default'} updatedAt={tasksQ.dataUpdatedAt}
            summaryRow={<span>{openTaskCount} open{overdueTaskCount > 0 && ` · ${overdueTaskCount} overdue`}</span>}>
            <TasksHealthPanel tasks={tasks} />
          </DashboardCard>
        </DashboardErrorBoundary>
      </div>

      {/* 8+9. Supplies and Issues */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DashboardErrorBoundary fallback="Supplies data unavailable">
          <DashboardCard title="Supplies" icon={<Package className="h-4 w-4" />}
            storageKey="supplies" panelId="aod-supplies" navigateTo="/supplies"
            accent={reorderWithoutTask.length > 0 ? 'warning' : reorderItems.length > 0 ? 'default' : 'success'}
            updatedAt={suppliesQ.dataUpdatedAt}
            summaryRow={<span>
              {reorderItems.length === 0 ? 'All stocked' : `${reorderItems.length} need reorder`}
              {reorderWithoutTask.length > 0 && ` · ${reorderWithoutTask.length} without task`}
            </span>}>
            <SuppliesReorderPanel items={supplyItems} tasks={tasks}
              onTaskCreated={() => { queryClient.invalidateQueries({ queryKey: ['/api/tasks'] }); }} />
          </DashboardCard>
        </DashboardErrorBoundary>

        <DashboardErrorBoundary fallback="Issues data unavailable">
          <DashboardCard title="Open Issues" icon={<CircleAlert className="h-4 w-4" />}
            storageKey="issues" panelId="aod-issues" navigateTo="/issues"
            accent={urgentHighIssues.length > 0 ? 'critical' : issues.length > 0 ? 'warning' : 'default'}
            updatedAt={issuesQ.dataUpdatedAt}
            summaryRow={<span>
              {issues.length === 0 ? 'No open issues' : `${issues.length} open`}
              {urgentHighIssues.length > 0 && ` · ${urgentHighIssues.length} urgent/high`}
            </span>}>
            <IssuesSnapshotPanel issues={issues} />
          </DashboardCard>
        </DashboardErrorBoundary>
      </div>

      {/* 10. Upcoming Shifts + Schedule Health */}
      <DashboardErrorBoundary fallback="Schedule data unavailable">
        <DashboardCard title="Upcoming Shifts" icon={<Calendar className="h-4 w-4" />}
          storageKey="upcoming-shifts" panelId="aod-schedule" navigateTo="/schedule" defaultExpanded
          accent={missingScheduleDays > 0 ? 'warning' : 'default'} updatedAt={schedQ.dataUpdatedAt}
          summaryRow={<span>
            {todaySchedules.filter((s) => new Date(s.startTime) > now && !activeEntries.some((e) => e.userId === s.userId)).length} upcoming today
            {huddleStatus && ` · Huddle: ${huddleStatus === 'completed' ? '✓' : 'pending'}`}
            {missingScheduleDays > 0 && ` · ${missingScheduleDays} gap${missingScheduleDays !== 1 ? 's' : ''} ahead`}
          </span>}>
          <UpcomingShiftsPanel todaySchedules={todaySchedules} weekSchedules={weekSchedules}
            users={users} timeEntries={todayEntries} locations={locations}
            scheduleGenerationDays={schedGenDays} huddleStatus={huddleStatus} />
        </DashboardCard>
      </DashboardErrorBoundary>

      {/* 11. Cash Status */}
      <DashboardErrorBoundary fallback="Cash status unavailable">
        <CashStatusCard />
      </DashboardErrorBoundary>
    </div>
  );
}
