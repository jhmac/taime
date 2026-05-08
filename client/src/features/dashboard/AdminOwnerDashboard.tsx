/**
 * AdminOwnerDashboard — redesigned to match the business health monitor design.
 * Layout: header bar → action cards → floor + team scores → KPI tiles →
 *         sales chart → AI insights + coming up → tasks / training / rituals
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
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Users, Clock, AlertTriangle, TrendingUp, TrendingDown, DollarSign,
  CheckSquare, Package, CircleAlert, Trophy, Calendar, ArrowRight,
  CheckCircle2, XCircle, Star, UserCheck, Sun, BarChart3, MapPin,
  Navigation, Square, ChevronRight, Bot, Coffee, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  format, differenceInMinutes, differenceInDays, startOfDay, addDays, isSameDay,
} from 'date-fns';

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────
interface User {
  id: string; firstName?: string | null; lastName?: string | null;
  email?: string | null; isActive?: boolean; locationId?: string | null;
  hourlyRate?: string | null; role?: string;
}
interface TimeEntry {
  id: string; userId: string; clockInTime: string; clockOutTime?: string | null;
  breakMinutes?: number; breakStartTime?: string | null; locationId?: string | null;
}
interface Schedule {
  id: string; userId: string; startTime: string; endTime: string; locationId?: string | null;
}
interface WorkLocation { id: string; name: string; isActive?: boolean; }
interface ClockEvent { userId: string; eventType: string; createdAt: string; }
interface OffsiteSession { id?: string; userId: string; status: string; destinationName?: string | null; }
interface GamificationScore {
  userId: string; firstName?: string | null; lastName?: string | null;
  overallScore: number; tier?: string;
  breakdown?: {
    attendance?: { normalized?: number }; tasks?: { normalized?: number };
    sops?: { normalized?: number }; engagement?: { normalized?: number };
    learning?: { normalized?: number };
  };
}
interface Task {
  id: string; title?: string; status?: string; dueDate?: string | null;
  updatedAt?: string | null; supplyItemId?: string | null; assignedTo?: string | null;
}
interface SupplyItem {
  id: string; name?: string; stockStatus?: string;
  pendingReorderTaskId?: string | null; reorderTaskId?: string | null;
}
interface Issue {
  id: string; title?: string; description?: string; priority?: string;
  severity?: string; createdAt?: string | null;
  assignedTo?: string | null; assignedToName?: string | null;
}
interface DailyGoal {
  hasGoal?: boolean; goalEnabled?: boolean;
  goal?: { revenue?: number; orders?: number };
  current?: { revenue?: number; orders?: number };
  progress?: number; amountRemaining?: number; salesNeeded?: number;
  averageOrderValue?: number; lastYearRevenue?: number; lastYearDate?: string;
}
interface PayrollSummary {
  shopConnected?: boolean; grossSales?: number; totalHours?: number;
  totalLaborCost?: number; splh?: number; laborPct?: number;
  employees?: Array<{ userId: string; name: string; totalHours: number; laborCost: number; wageRate: number }>;
  settings?: { payrollTargetPct?: number };
}
interface Kudo { toEmployeeId?: string; createdAt?: string; }

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function fmt(n: number | undefined | null, dec = 0): string {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(dec);
}
function fmtMoney(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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
function initials(u: Pick<User, 'firstName' | 'lastName' | 'email'>): string {
  const f = u.firstName?.[0] ?? '';
  const l = u.lastName?.[0] ?? '';
  if (f || l) return `${f}${l}`.toUpperCase();
  return (u.email?.[0] ?? '?').toUpperCase();
}
const AVATAR_COLORS = [
  'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
];
function avatarColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = uid.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rich action item card (colored left border)
// ─────────────────────────────────────────────────────────────────────────────
type ActionSeverity = 'red' | 'orange' | 'green' | 'blue' | 'amber';
interface RichActionItem {
  id: string;
  severity: ActionSeverity;
  title: string;
  subtitle: string;
  linkLabel?: string;
  linkTarget?: string;
  badgeLabel: string;
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

function ActionItemCard({ item, onNavigate }: { item: RichActionItem; onNavigate: (path: string) => void }) {
  return (
    <div className={cn('bg-white dark:bg-card rounded-lg border border-border shadow-sm flex items-start gap-3 px-4 py-3', severityLeft[item.severity])}>
      <Square className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{item.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.subtitle}</p>
        {item.linkLabel && item.linkTarget && (
          <button
            onClick={() => onNavigate(item.linkTarget!)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 flex items-center gap-0.5"
          >
            {item.linkLabel} <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <span className={cn('text-xs font-medium px-2 py-0.5 rounded border whitespace-nowrap shrink-0 mt-0.5', severityBadge[item.severity])}>
        {item.badgeLabel}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floor Status — compact rows with avatar
// ─────────────────────────────────────────────────────────────────────────────
function FloorStatusPanel({
  timeEntries, todaySchedules, users, locations, offsiteSessions, lateThresholdMinutes, onNavigate,
}: {
  timeEntries: TimeEntry[]; todaySchedules: Schedule[]; users: User[];
  locations: WorkLocation[]; offsiteSessions: OffsiteSession[];
  lateThresholdMinutes: number; onNavigate: (path: string) => void;
}) {
  const now = new Date();
  const userMap = new Map(users.map((u) => [u.id, u]));
  const activeByUser = new Map<string, TimeEntry>(
    timeEntries.filter((e) => !e.clockOutTime).map((e) => [e.userId, e])
  );
  const offsiteMap = new Map<string, OffsiteSession>(
    offsiteSessions.filter((s) => s.status === 'active').map((s) => [s.userId, s])
  );
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  const startedSchedules = todaySchedules.filter((s) => new Date(s.startTime) <= now);
  const upcomingSchedules = todaySchedules.filter((s) => new Date(s.startTime) > now);
  const allUids = new Set([
    ...startedSchedules.map((s) => s.userId),
    ...[...activeByUser.keys()],
  ]);

  type Row = {
    uid: string; u: User | undefined;
    status: 'on-shift' | 'late' | 'break' | 'no-show' | 'upcoming' | 'early-departure';
    locationName: string; detail: string; endTime?: string;
  };
  const rows: Row[] = [];

  for (const uid of allUids) {
    const u = userMap.get(uid);
    const entry = activeByUser.get(uid);
    const sched = startedSchedules.find((s) => s.userId === uid);
    const locName = sched?.locationId ? (locMap.get(sched.locationId) ?? '') : (entry?.locationId ? (locMap.get(entry.locationId) ?? '') : '');
    const offsite = offsiteMap.get(uid);

    if (entry && !entry.clockOutTime) {
      const late = sched ? differenceInMinutes(new Date(entry.clockInTime), new Date(sched.startTime)) > lateThresholdMinutes : false;
      const onBreak = !!entry.breakStartTime;
      const sinceLabel = `Since ${format(new Date(entry.clockInTime), 'h:mm a')}`;
      const endTime = sched ? format(new Date(sched.endTime), 'h:mm a') : undefined;
      rows.push({
        uid, u, locationName: offsite ? (offsite.destinationName ?? 'Off-site') : locName,
        status: onBreak ? 'break' : late ? 'late' : 'on-shift',
        detail: sinceLabel, endTime,
      });
    } else if (sched && !activeByUser.has(uid)) {
      const schedStart = new Date(sched.startTime);
      const schedEnd = new Date(sched.endTime);
      // Find a completed entry that overlaps this schedule window:
      //   clockIn < schedEnd  (they arrived before the shift ended)
      //   clockOut > schedStart (they were present during the shift window)
      // This correctly handles early clock-ins (before schedStart) and excludes
      // prior-shift entries whose clockOut predates this shift's start.
      const correlatedEntry = timeEntries.find(
        (e) => e.userId === uid && e.clockOutTime &&
          new Date(e.clockInTime) < schedEnd &&
          new Date(e.clockOutTime!) > schedStart
      );
      const clockedOutEarly = correlatedEntry &&
        new Date(correlatedEntry.clockOutTime!) < schedEnd;

      if (clockedOutEarly && now < schedEnd) {
        // Employee clocked out early and the shift window hasn't ended yet — show the flag
        rows.push({
          uid, u, locationName: locName, status: 'early-departure',
          detail: `Left ${format(new Date(correlatedEntry!.clockOutTime!), 'h:mm a')}`,
          endTime: format(schedEnd, 'h:mm a'),
        });
      } else if (correlatedEntry) {
        // Employee completed (or early-departed and window has passed) — drop from card silently
      } else {
        // No clock-in at all for this shift window → genuine no-show
        rows.push({ uid, u, locationName: locName, status: 'no-show', detail: `Shift ${format(schedStart, 'h:mm a')}` });
      }
    }
  }

  // Upcoming shifts
  const upcomingRows = upcomingSchedules
    .filter((s) => !activeByUser.has(s.userId))
    .slice(0, 3)
    .map((s) => {
      const u = userMap.get(s.userId);
      return {
        uid: s.userId, u, locationName: s.locationId ? (locMap.get(s.locationId) ?? '') : '',
        status: 'upcoming' as const, detail: `Arriving ${format(new Date(s.startTime), 'h:mm a')}`,
      };
    });

  const allRows = [...rows, ...upcomingRows].slice(0, 8);

  const statusBadge: Record<string, { label: string; cls: string; rowCls?: string }> = {
    'on-shift':        { label: 'On shift',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    'late':            { label: 'Late',             cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    'break':           { label: 'Break',            cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
    'no-show':         { label: 'No-show',          cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    'upcoming':        { label: 'Scheduled',        cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    'early-departure': { label: 'Early departure',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', rowCls: 'bg-amber-50/60 dark:bg-amber-900/10' },
  };

  return (
    <div className="space-y-1">
      {allRows.length === 0 && (
        <p className="text-sm text-muted-foreground py-3 text-center">No active shifts right now.</p>
      )}
      {allRows.map(({ uid, u, locationName, status, detail, endTime }) => {
        const { label, cls, rowCls } = statusBadge[status];
        return (
          <div key={uid} className={cn('flex items-center gap-3 py-2 px-1.5 rounded-md border-b border-border/40 last:border-0', rowCls)}>
            <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0', avatarColor(uid))}>
              {u ? initials(u) : '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{u ? uName(u) : 'Employee'}</p>
              <p className="text-xs text-muted-foreground">
                {detail}{locationName ? ` · ${locationName}` : ''}
                {endTime && <span className="ml-1 text-muted-foreground/70">· Until {endTime}</span>}
              </p>
            </div>
            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', cls)}>{label}</span>
          </div>
        );
      })}
      <button onClick={() => onNavigate('/time')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 pt-1">
        All locations <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Scores
// ─────────────────────────────────────────────────────────────────────────────
function TeamScoresPanel({ scores, onNavigate }: { scores: GamificationScore[]; onNavigate: (path: string) => void }) {
  const [tab, setTab] = useState<'top' | 'support'>('top');
  const sorted = [...scores].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
  const THRESHOLD = 70;
  const top = sorted.slice(0, 5);
  const support = sorted.filter((s) => (s.overallScore ?? 0) < THRESHOLD).slice(0, 5);
  const displayed = tab === 'top' ? top : support;
  const maxScore = 100;

  const barColor = (score: number) =>
    score >= THRESHOLD ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div>
      <div className="flex gap-1 mb-3">
        {(['top', 'support'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('text-xs px-3 py-1 rounded-full font-medium transition-colors',
              tab === t ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80')}>
            {t === 'top' ? 'Top performers' : 'Needs support'}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {displayed.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-3">No data yet</p>
        )}
        {displayed.map((s) => {
          const name = `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || 'Employee';
          const score = Math.round(s.overallScore ?? 0);
          return (
            <div key={s.userId}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium">{name}</span>
                <span className={cn('text-sm font-bold', score >= THRESHOLD ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>{score}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', barColor(score))}
                  style={{ width: `${(score / maxScore) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {tab === 'support' && support.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2">Below threshold ({THRESHOLD})</p>
      )}
      <button onClick={() => onNavigate('/gamification')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 mt-3">
        View all <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Tiles
// ─────────────────────────────────────────────────────────────────────────────
function KPITile({ label, value, target, delta, warn }: {
  label: string; value: string; target?: string; delta?: string; warn?: boolean;
}) {
  return (
    <div className="bg-muted/40 dark:bg-muted/20 border border-border rounded-xl px-5 py-4 flex flex-col gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn('text-3xl font-bold', warn ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>{value}</p>
      {target && <p className="text-xs text-muted-foreground">Target: {target}</p>}
      {delta && <p className="text-xs text-emerald-600 dark:text-emerald-400">{delta}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sales Chart
// ─────────────────────────────────────────────────────────────────────────────
function SalesChartPanel({ dailyGoal }: { dailyGoal: DailyGoal | null | undefined }) {
  const now = new Date();
  const storeOpen = 8; const storeClose = 21;
  const currentRevenue = dailyGoal?.current?.revenue ?? 0;
  const goalRevenue = dailyGoal?.goal?.revenue ?? 0;
  const lastYearRevenue = dailyGoal?.lastYearRevenue ?? (goalRevenue > 0 ? goalRevenue * 0.88 : 0);

  // Generate hourly data points
  const hours = Array.from({ length: storeClose - storeOpen + 1 }, (_, i) => storeOpen + i);
  const currentHour = now.getHours() + now.getMinutes() / 60;

  const data = hours.map((h) => {
    const progress = Math.max(0, Math.min(1, (h - storeOpen) / (storeClose - storeOpen)));
    // S-curve approximation for actual sales
    const sCurve = (x: number) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    const goalAtHour = goalRevenue * sCurve(progress);
    const lastYearAtHour = lastYearRevenue * sCurve(progress);
    const actualAtHour = h <= currentHour ? currentRevenue * sCurve(Math.min(progress / Math.max((currentHour - storeOpen) / (storeClose - storeOpen), 0.01), 1)) : undefined;
    return {
      hour: `${h <= 12 ? h : h - 12}${h < 12 ? 'AM' : 'PM'}`,
      goal: Math.round(goalAtHour),
      lastYear: Math.round(lastYearAtHour),
      actual: actualAtHour != null ? Math.round(actualAtHour) : undefined,
    };
  });

  const pct = goalRevenue > 0 ? Math.round((currentRevenue / goalRevenue) * 100) : 0;

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={45} />
          <Tooltip formatter={(val, name) => [`$${Number(val).toLocaleString()}`, name === 'actual' ? 'Actual' : name === 'goal' ? 'Goal' : 'Last year']} />
          <Line type="monotone" dataKey="goal" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="goal" />
          <Line type="monotone" dataKey="lastYear" stroke="#9ca3af" strokeWidth={1} dot={false} name="lastYear" />
          <Line type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2} dot={false} name="actual" connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-1 justify-center">
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="inline-block w-5 h-0.5 bg-blue-500 rounded" /> Actual {fmtMoney(currentRevenue)}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="inline-block w-5 h-0.5 bg-amber-400 rounded border-dashed" style={{ borderTop: '1.5px dashed #f59e0b', background: 'none' }} /> Goal {fmtMoney(goalRevenue)}</span>
        {lastYearRevenue > 0 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="inline-block w-5 h-0.5 bg-gray-400 rounded" /> Last year {fmtMoney(lastYearRevenue)}</span>}
      </div>
      {goalRevenue === 0 && (
        <p className="text-xs text-muted-foreground text-center mt-2">Connect Shopify and enable daily goal in Settings to activate this chart.</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Insights (briefing as list or direct text)
// ─────────────────────────────────────────────────────────────────────────────
interface BriefingPayload {
  activeCount: number; scheduledCount: number; lateSinceOpen: number;
  salesVsGoalPct: number | null; openIssues: number; openTasks: number;
  payrollHealthPct: number | null; topPerformer: string | null; dayOfWeek: string;
}
function AIInsightsPanel(props: BriefingPayload & { onNavigate: (p: string) => void }) {
  const { data, mutate, isPending, isError } = useMutation({
    mutationFn: async (bypass?: boolean) => {
      const r = await apiRequest('POST', '/api/dashboard/ai-briefing', { ...props, bypassCache: bypass });
      return r.json() as Promise<{ briefing: string }>;
    },
  });
  useEffect(() => { mutate(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build smart insight bullets from the briefing text
  const briefingText = data?.briefing ?? '';
  const sentences = briefingText.split(/[.!]/).map((s) => s.trim()).filter((s) => s.length > 10).slice(0, 4);
  const insightColors: ActionSeverity[] = ['red', 'orange', 'amber', 'blue'];

  if (isPending) return (
    <div className="space-y-2">{[1, 0.9, 0.8].map((w, i) => <Skeleton key={i} className="h-10 w-full" style={{ opacity: w }} />)}</div>
  );

  if (isError || !briefingText) return (
    <div className="flex flex-col gap-2 items-start">
      <p className="text-sm text-muted-foreground">Could not generate AI insights.</p>
      <Button variant="outline" size="sm" onClick={() => mutate(false)} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );

  return (
    <div>
      <div className="space-y-2">
        {sentences.map((s, i) => (
          <div key={i} className={cn('border-l-2 pl-3 py-0.5 text-sm',
            i === 0 ? 'border-red-400' : i === 1 ? 'border-orange-400' : i === 2 ? 'border-amber-400' : 'border-blue-400')}>
            <p className="text-foreground/90 leading-snug">{s}.</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground gap-1"
          disabled={isPending} onClick={() => mutate(true)}>
          <RefreshCw className="h-3 w-3" /> Regenerate
        </Button>
        <button onClick={() => props.onNavigate('/analytics')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
          View all <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Coming Up This Week
// ─────────────────────────────────────────────────────────────────────────────
function ComingUpPanel({ weekSchedules, locations, users, onNavigate }: {
  weekSchedules: Schedule[]; locations: WorkLocation[]; users: User[]; onNavigate: (p: string) => void;
}) {
  const now = new Date();
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const days = Array.from({ length: 6 }, (_, i) => addDays(now, i + 1));
  const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const items = days.map((day) => {
    const shifts = weekSchedules.filter((s) => isSameDay(new Date(s.startTime), day));
    const locs = [...new Set(shifts.map((s) => s.locationId ? (locMap.get(s.locationId) ?? '') : '').filter(Boolean))];
    return { day, shifts, locs };
  }).filter((d) => d.shifts.length > 0).slice(0, 5);

  return (
    <div className="space-y-2.5">
      {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No upcoming shifts scheduled.</p>}
      {items.map(({ day, shifts, locs }) => (
        <div key={day.toISOString()} className="flex items-start gap-3">
          <div className="w-9 shrink-0 text-center">
            <p className="text-[9px] font-bold text-muted-foreground">{DAY_LABELS[day.getDay()]}</p>
            <p className="text-sm font-bold">{format(day, 'd')}</p>
          </div>
          <div className="flex-1 min-w-0 border-l border-border/50 pl-3">
            <p className="text-sm font-medium">{shifts.length} shift{shifts.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-muted-foreground truncate">{locs.join(', ') || 'Various locations'}</p>
          </div>
        </div>
      ))}
      <button onClick={() => onNavigate('/schedule')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 pt-1">
        View full schedule <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks & SOPs mini
// ─────────────────────────────────────────────────────────────────────────────
function TasksSOPMini({ tasks, scores, onNavigate }: { tasks: Task[]; scores: GamificationScore[]; onNavigate: (p: string) => void }) {
  const now = new Date();
  const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const done = tasks.filter((t) => t.status === 'completed' && t.updatedAt && new Date(t.updatedAt) >= startOfDay(now));
  const overdue = open.filter((t) => t.dueDate && new Date(t.dueDate) < startOfDay(now));
  const quickWins = open.filter((t) => !t.dueDate).length;

  // SOP completion estimate from gamification sops score
  const sopScores = scores.map((s) => s.breakdown?.sops?.normalized ?? 0);
  const sopPct = sopScores.length > 0 ? Math.round(sopScores.reduce((a, b) => a + b, 0) / sopScores.length) : null;
  const total = open.length + done.length;

  return (
    <div>
      {sopPct != null && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">SOP rate</span>
          <span className="text-lg font-bold text-emerald-600">{sopPct}%</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Tasks done today</span>
        <span className="text-lg font-bold">{done.length}<span className="text-sm text-muted-foreground">/{total > 0 ? total : '—'}</span></span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/50 p-2 text-center">
          <p className={cn('text-xl font-bold', overdue.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{overdue.length}</p>
          <p className="text-xs text-muted-foreground">Overdue</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-2 text-center">
          <p className="text-xl font-bold text-emerald-600">{quickWins}</p>
          <p className="text-xs text-muted-foreground">Quick wins</p>
        </div>
      </div>
      <button onClick={() => onNavigate('/tasks')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 mt-3">
        View tasks <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Training mini
// ─────────────────────────────────────────────────────────────────────────────
function TrainingMini({ scores, onNavigate }: { scores: GamificationScore[]; onNavigate: (p: string) => void }) {
  const learningScores = scores.map((s) => s.breakdown?.learning?.normalized ?? 0);
  const avgLearning = learningScores.length > 0 ? Math.round(learningScores.reduce((a, b) => a + b, 0) / learningScores.length) : null;
  const topLearner = [...scores].sort((a, b) => (b.breakdown?.learning?.normalized ?? 0) - (a.breakdown?.learning?.normalized ?? 0))[0];
  const topLearnerName = topLearner ? (topLearner.firstName ?? 'Employee') : null;

  return (
    <div>
      <div className="space-y-2">
        {avgLearning != null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Avg. learning score</span>
            <span className="text-lg font-bold">{avgLearning}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Team members</span>
          <span className="text-lg font-bold">{scores.length}</span>
        </div>
        {topLearnerName && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs">
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">🏆 Top learner: {topLearnerName}</span>
          </div>
        )}
      </div>
      <button onClick={() => onNavigate('/learning')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 mt-3">
        Learning center <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Rituals mini
// ─────────────────────────────────────────────────────────────────────────────
interface DailyRitualsProps {
  huddleStatus: string | null;
  huddleLedByName: string | null;
  openingChecklistCompleter: string | null;
  middayPulseExists: boolean;
  debriefCount: number;
  onNavigate: (p: string) => void;
}

function DailyRitualsMini({
  huddleStatus, huddleLedByName, openingChecklistCompleter,
  middayPulseExists, debriefCount, onNavigate,
}: DailyRitualsProps) {
  const rituals = [
    {
      label: 'Morning huddle',
      done: huddleStatus === 'completed',
      active: huddleStatus === 'in_progress',
      completerLabel: huddleLedByName ?? null,
    },
    {
      label: 'Opening checklist',
      done: openingChecklistCompleter !== null,
      active: false,
      completerLabel: openingChecklistCompleter,
    },
    {
      label: 'Midday pulse',
      done: middayPulseExists,
      active: false,
      completerLabel: middayPulseExists ? 'Auto' : null,
    },
    {
      label: 'Daily debrief',
      done: debriefCount > 0,
      active: false,
      completerLabel: debriefCount > 0 ? `${debriefCount} submitted` : null,
    },
  ];

  return (
    <div>
      <div className="space-y-2 mb-3">
        {rituals.map(({ label, done, active, completerLabel }) => (
          <div key={label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {done
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                : <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <span className={cn('text-sm', done ? 'text-muted-foreground line-through' : 'text-foreground')}>{label}</span>
            </div>
            {active && !done && (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400">Now</Badge>
            )}
            {done && completerLabel && (
              <span className="text-xs text-muted-foreground">Done · {completerLabel}</span>
            )}
            {done && !completerLabel && (
              <span className="text-xs text-muted-foreground">Done</span>
            )}
          </div>
        ))}
      </div>
      <Button size="sm" className="w-full gap-1.5 h-8 text-xs" onClick={() => onNavigate('/rituals')}>
        <Sun className="h-3.5 w-3.5" />
        {huddleStatus === 'completed' ? 'View debrief' : 'Start morning huddle'}
      </Button>
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
  const topN: number               = (settings?.dashboardTopBottomN as number) ?? 3;
  const lateCountThreshold: number = (settings?.lateClockInAlertThreshold as number) ?? 2;
  const lateThresholdMin: number   = (settings?.lateThresholdMinutes as number) ?? 5;
  const schedGenDays: number       = (settings?.scheduleGenerationDays as number) ?? 5;
  const bronzeThreshold            = 40;

  // ── Auth user (for greeting) ───────────────────────────────────────────────
  const { data: authUser } = useQuery<{ firstName?: string; lastName?: string }>({
    queryKey: ['/api/auth/user'],
    staleTime: 10 * 60_000,
  });
  const firstName = (authUser as any)?.firstName ?? (authUser as any)?.user?.firstName ?? '';

  // ── Queries ───────────────────────────────────────────────────────────────
  async function fetchArr<T>(url: string): Promise<T[]> {
    const r = await apiRequest('GET', url);
    const j = await r.json();
    return Array.isArray(j) ? j : (j.data ?? j.schedules ?? j.items ?? j.users ?? j.scores ?? []);
  }

  const entriesQ = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries', 'today'],
    queryFn: () => fetchArr<TimeEntry>(`/api/time-entries?startDate=${today}&endDate=${today}&includeActive=true`),
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
    queryFn: async () => { const r = await apiRequest('GET', '/api/issues?status=open'); return r.json(); },
    staleTime: 60_000, refetchInterval: 2 * 60_000,
  });
  const issues: Issue[] = Array.isArray(issuesQ.data) ? issuesQ.data as Issue[] : ((issuesQ.data as any)?.data ?? []);

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
  const huddleStatus: string | null = (huddleQ.data as any)?.data?.status ?? null;
  const huddleLedByName: string | null = (huddleQ.data as any)?.data?.ledByName ?? null;

  const openingChecklistQ = useQuery<{ employeeId: string; employeeName: string } | null>({
    queryKey: ['/api/rituals/opening-checklist/today'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/rituals/opening-checklist/today');
      if (!r.ok) return null;
      const j = await r.json();
      return j.data ?? null;
    },
    staleTime: 5 * 60_000,
  });
  const openingChecklistCompleter: string | null = openingChecklistQ.data?.employeeName ?? null;

  const pulseStatusQ = useQuery<{ exists: boolean }>({
    queryKey: ['/api/rituals/pulse/status'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/rituals/pulse/status');
      if (!r.ok) return { exists: false };
      const j = await r.json();
      return j.data ?? { exists: false };
    },
    staleTime: 5 * 60_000,
  });
  const middayPulseExists: boolean = pulseStatusQ.data?.exists ?? false;

  const debriefQ = useQuery<Array<{ id: string }>>({
    queryKey: ['/api/rituals/debrief', 'today'],
    queryFn: async () => {
      const r = await apiRequest('GET', '/api/rituals/debrief');
      if (!r.ok) return [];
      const j = await r.json();
      return Array.isArray(j.data) ? j.data : [];
    },
    staleTime: 5 * 60_000,
  });
  const debriefCount: number = debriefQ.data?.length ?? 0;

  // Score histories
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
  const upcomingSoon = todaySchedules.filter((s) => {
    const minsTo = differenceInMinutes(new Date(s.startTime), now);
    return minsTo > 0 && minsTo <= 60;
  }).length;

  const floorNoShows = todaySchedules.filter((s) =>
    new Date(s.startTime) <= now && !todayEntries.some((e) => e.userId === s.userId)
  );

  const hrNoShows = todaySchedules.filter((s) =>
    new Date(s.endTime) < now && !todayEntries.some((e) => e.userId === s.userId)
  );

  const lateSinceOpen = activeEntries.filter((e) => {
    const sched = todaySchedules.find((s) => s.userId === e.userId);
    if (!sched) return false;
    return differenceInMinutes(new Date(e.clockInTime), new Date(sched.startTime)) > lateThresholdMin;
  }).length;

  const lateCountByUser = new Map<string, number>();
  for (const ev of clockEvents) {
    if (ev.eventType === 'late-clock-in' || ev.eventType === 'excessive-late') {
      lateCountByUser.set(ev.userId, (lateCountByUser.get(ev.userId) ?? 0) + 1);
    }
  }
  const tardyEmployees = [...lateCountByUser.entries()]
    .filter(([, count]) => count >= lateCountThreshold)
    .map(([uid, count]) => ({ uid, count, u: userMap.get(uid) }));

  const belowBronze = sortedScores.filter((e) => (e.overallScore ?? 0) < bronzeThreshold);

  const cutoff14d = now.getTime() - 14 * 86400000;
  const recentKudoRecipients = new Set(
    recentKudos.filter((k) => k.createdAt && new Date(k.createdAt).getTime() >= cutoff14d)
      .map((k) => k.toEmployeeId).filter((id): id is string => !!id)
  );
  const medianScore = sortedScores.length > 0 ? (sortedScores[Math.floor(sortedScores.length / 2)]?.overallScore ?? 0) : 50;
  const topPerformersNeedingKudos = sortedScores.filter((s) =>
    (s.overallScore ?? 0) >= medianScore && !recentKudoRecipients.has(s.userId)
  ).slice(0, 3);

  const laborPct      = payQ.data?.laborPct ?? null;
  const splh          = payQ.data?.splh ?? null;
  const payrollTarget = payQ.data?.settings?.payrollTargetPct ?? 30;
  const overTarget    = laborPct != null && laborPct > payrollTarget;
  const payrollHealthPct = laborPct != null ? Math.round((laborPct / payrollTarget) * 100) : null;

  const reorderItems = supplyItems.filter((i) => i.stockStatus === 'low' || i.stockStatus === 'critical' || i.stockStatus === 'empty');
  const reorderWithoutTask = reorderItems.filter((item) =>
    !(item.pendingReorderTaskId || item.reorderTaskId) &&
    !tasks.some((t) => t.status !== 'completed' && t.status !== 'cancelled' &&
      ((t.title ?? '').toLowerCase().includes((item.name ?? '').toLowerCase()) || t.supplyItemId === item.id))
  );

  const overdueTaskCount = tasks.filter((t) =>
    t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate && new Date(t.dueDate) < startOfDay(now)
  ).length;

  const urgentHighIssues = issues.filter((i) =>
    ['critical', 'urgent', 'high'].includes((i.severity ?? i.priority ?? '').toLowerCase())
  );

  const missingScheduleDays = Array.from({ length: schedGenDays }, (_, i) => {
    const day = addDays(now, i + 1);
    return weekSchedules.some((s) => isSameDay(new Date(s.startTime), day));
  }).filter((has) => !has).length;

  const topPerformerName = sortedScores[0]
    ? `${sortedScores[0].firstName ?? ''} ${sortedScores[0].lastName ?? ''}`.trim() || null
    : null;

  const salesVsGoalPct = goalQ.data?.hasGoal
    ? (goalQ.data.progress ?? (
        (goalQ.data.goal?.revenue ?? 0) > 0
          ? Math.round(((goalQ.data.current?.revenue ?? 0) / goalQ.data.goal!.revenue!) * 100)
          : null
      ))
    : null;
  const openTaskCount = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;

  // ── Rich action items ─────────────────────────────────────────────────────
  const richActions: RichActionItem[] = [];

  // Tardiness
  tardyEmployees.slice(0, 2).forEach(({ u, count }) => {
    const name = u ? uName(u) : 'Employee';
    richActions.push({
      id: `tardy-${u?.id ?? count}`,
      severity: 'red',
      title: `${name} — late ${count} time${count !== 1 ? 's' : ''} this week`,
      subtitle: `Clocked in late ${count} time${count !== 1 ? 's' : ''} this pay period. Policy: verbal warning after ${lateCountThreshold}.`,
      linkLabel: 'Draft conversation guide',
      linkTarget: '/time',
      badgeLabel: 'Action needed',
      urgency: 1,
    });
  });

  // No-shows (shift ended)
  if (hrNoShows.length > 0) {
    const names = hrNoShows.slice(0, 2).map((s) => userMap.get(s.userId)).filter(Boolean).map((u) => u!.firstName ?? 'Employee');
    richActions.push({
      id: 'no-shows',
      severity: 'red',
      title: `${hrNoShows.length} employee${hrNoShows.length !== 1 ? 's' : ''} missed their shift`,
      subtitle: `${names.join(', ')}${hrNoShows.length > 2 ? ` +${hrNoShows.length - 2} more` : ''} did not clock in.`,
      linkLabel: 'View time records',
      linkTarget: '/time',
      badgeLabel: 'Action needed',
      urgency: 1,
    });
  }

  // Overdue tasks
  if (overdueTaskCount > 0) {
    const overdueTasks = tasks.filter((t) =>
      t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate && new Date(t.dueDate) < startOfDay(now)
    );
    const titles = overdueTasks.slice(0, 3).map((t) => t.title ?? 'Untitled task');
    richActions.push({
      id: 'overdue-tasks',
      severity: 'orange',
      title: `${overdueTaskCount} task${overdueTaskCount !== 1 ? 's' : ''} overdue`,
      subtitle: titles.join(', ') + (overdueTasks.length > 3 ? ` and ${overdueTasks.length - 3} more.` : '.'),
      linkLabel: 'View missed tasks',
      linkTarget: '/tasks',
      badgeLabel: 'Review',
      urgency: 2,
    });
  }

  // Top performer milestone (highest score > 90)
  const milestone = sortedScores.find((s) => (s.overallScore ?? 0) >= 90);
  if (milestone) {
    const name = `${milestone.firstName ?? ''} ${milestone.lastName ?? ''}`.trim() || 'Employee';
    richActions.push({
      id: `milestone-${milestone.userId}`,
      severity: 'green',
      title: `${name} hit ${Math.round(milestone.overallScore)} — milestone!`,
      subtitle: `Top performer with outstanding scores across attendance, tasks, and SOPs.`,
      linkLabel: 'Send recognition',
      linkTarget: '/kudos',
      badgeLabel: 'Celebrate',
      urgency: 3,
    });
  }

  // Supplies
  if (reorderWithoutTask.length > 0) {
    const names = reorderWithoutTask.slice(0, 3).map((i) => i.name ?? 'item');
    richActions.push({
      id: 'supplies',
      severity: 'blue',
      title: `${reorderWithoutTask.length} supply item${reorderWithoutTask.length !== 1 ? 's' : ''} need reorder`,
      subtitle: names.join(', ') + (reorderWithoutTask.length > 3 ? ` and ${reorderWithoutTask.length - 3} more` : '') + ' running low.',
      linkLabel: 'View supply list',
      linkTarget: '/supplies',
      badgeLabel: 'Reorder',
      urgency: 4,
    });
  }

  // Open issues
  if (issues.length > 0) {
    const topIssues = issues.slice(0, 2).map((i) => i.title ?? i.description?.slice(0, 40) ?? 'Issue');
    richActions.push({
      id: 'issues',
      severity: 'blue',
      title: `${issues.length} team issue${issues.length !== 1 ? 's' : ''} submitted`,
      subtitle: topIssues.join(' · ') + (issues.length > 2 ? ` and ${issues.length - 2} more.` : '.'),
      linkLabel: 'Review issues',
      linkTarget: '/issues',
      badgeLabel: urgentHighIssues.length > 0 ? 'Urgent' : 'Review',
      urgency: urgentHighIssues.length > 0 ? 2 : 5,
    });
  }

  const sortedActions = richActions.sort((a, b) => a.urgency - b.urgency);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (entriesQ.isLoading || usersQ.isLoading || schedQ.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  const currentRevenue = goalQ.data?.current?.revenue ?? 0;
  const goalRevenue    = goalQ.data?.goal?.revenue ?? 0;
  const lastYearRevenue = goalQ.data?.lastYearRevenue ?? (goalRevenue > 0 ? goalRevenue * 0.88 : 0);
  const vsLastYearPct = lastYearRevenue > 0 ? Math.round(((currentRevenue - lastYearRevenue) / lastYearRevenue) * 100) : null;

  const activeLocations = locations.filter((l) => l.isActive !== false);

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-5xl mx-auto">

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-zinc-900 dark:bg-zinc-950 text-white p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-400 font-medium">
            Good morning{firstName ? `, ${firstName}` : ''}
          </p>
          <h1 className="text-2xl font-bold tracking-tight mt-0.5">
            {format(now, 'EEEE, MMMM d')} — {format(now, 'h:mm a')}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {activeLocations.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-white/10 rounded-full px-3 py-1">
                <MapPin className="h-3 w-3" /> {activeLocations.length} location{activeLocations.length !== 1 ? 's' : ''} open
              </span>
            )}
            <span className="flex items-center gap-1.5 text-xs bg-white/10 rounded-full px-3 py-1">
              <Users className="h-3 w-3" /> {activeCount} on floor
            </span>
            {upcomingSoon > 0 && (
              <span className="flex items-center gap-1.5 text-xs bg-white/10 rounded-full px-3 py-1">
                <Clock className="h-3 w-3" /> {upcomingSoon} arriving soon
              </span>
            )}
          </div>
        </div>

        {/* Sales vs Goal box */}
        {goalQ.data?.hasGoal && goalRevenue > 0 ? (
          <div className="sm:text-right shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Today's Sales vs Goal</p>
            <p className="text-3xl font-bold mt-1">
              {fmtMoney(currentRevenue)}
              <span className="text-zinc-400 text-xl font-normal"> / {fmtMoney(goalRevenue)}</span>
            </p>
            <div className="w-full sm:w-40 mt-2 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', (salesVsGoalPct ?? 0) >= 100 ? 'bg-emerald-400' : 'bg-emerald-500')}
                style={{ width: `${Math.min(salesVsGoalPct ?? 0, 100)}%` }}
              />
            </div>
            {vsLastYearPct != null && (
              <p className="text-xs text-zinc-300 mt-1">
                {vsLastYearPct >= 0 ? `+${vsLastYearPct}%` : `${vsLastYearPct}%`} vs last year
              </p>
            )}
            {lastYearRevenue > 0 && (
              <p className="text-xs text-zinc-400 mt-0.5">
                Last year{goalQ.data?.lastYearDate ? ` (${format(new Date(goalQ.data.lastYearDate.substring(0, 10) + 'T12:00:00'), 'EEE MMM d')})` : ''}: {fmtMoney(lastYearRevenue)}
              </p>
            )}
          </div>
        ) : (
          <div className="sm:text-right shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Today's Sales vs Goal</p>
            <p className="text-sm text-zinc-500 mt-1">No goal configured</p>
            <button onClick={() => navigate('/admin?section=pos-connection')}
              className="text-xs text-blue-400 hover:underline mt-1">Set up Shopify →</button>
          </div>
        )}
      </div>

      {/* ── ACTION REQUIRED CARDS ─────────────────────────────────────────── */}
      {sortedActions.length > 0 && (
        <DashboardErrorBoundary fallback="Could not load action items">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Action required</p>
            <div className="space-y-2">
              {sortedActions.map((item) => (
                <ActionItemCard key={item.id} item={item} onNavigate={(p) => navigate(p)} />
              ))}
            </div>
          </div>
        </DashboardErrorBoundary>
      )}

      {sortedActions.length === 0 && !entriesQ.isLoading && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> All clear — no urgent actions right now.
        </div>
      )}

      {/* ── FLOOR STATUS + TEAM SCORES ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Who's on floor now</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DashboardErrorBoundary fallback="Floor status unavailable">
              <FloorStatusPanel
                timeEntries={todayEntries} todaySchedules={todaySchedules}
                users={users} locations={locations} offsiteSessions={offsiteSessions}
                lateThresholdMinutes={lateThresholdMin} onNavigate={(p) => navigate(p)} />
            </DashboardErrorBoundary>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Team scores</CardTitle>
              <button onClick={() => navigate('/gamification')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">View all</button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DashboardErrorBoundary fallback="Score data unavailable">
              <TeamScoresPanel scores={gamificationScores} onNavigate={(p) => navigate(p)} />
            </DashboardErrorBoundary>
          </CardContent>
        </Card>
      </div>

      {/* ── KPI TILES ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <KPITile
          label="Payroll %"
          value={laborPct != null ? `${fmt(laborPct, 1)}%` : '—'}
          target={`${payrollTarget}%`}
          warn={overTarget}
        />
        <KPITile
          label="Sales / Labor Hr"
          value={splh != null ? `$${fmt(splh, 0)}` : '—'}
          target={payQ.data?.grossSales && payQ.data?.totalHours ? `$${fmt((payQ.data.grossSales / payQ.data.totalHours) * 1.1, 0)}` : undefined}
        />
        <KPITile
          label="SOP Completion"
          value={(() => {
            const scores = gamificationScores.map((s) => s.breakdown?.sops?.normalized ?? 0);
            return scores.length > 0 ? `${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}%` : '—';
          })()}
          delta={(() => {
            const scores = gamificationScores.map((s) => s.breakdown?.sops?.normalized ?? 0);
            return scores.length > 0 ? undefined : undefined;
          })()}
        />
      </div>

      {/* ── SALES CHART ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Sales vs goal — today</CardTitle>
            <button onClick={() => navigate('/analytics')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Weekly view</button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <DashboardErrorBoundary fallback="Sales chart unavailable">
            <SalesChartPanel dailyGoal={goalQ.data} />
          </DashboardErrorBoundary>
        </CardContent>
      </Card>

      {/* ── AI INSIGHTS + COMING UP ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Bot className="h-4 w-4 text-muted-foreground" /> AI insights — today
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DashboardErrorBoundary fallback="AI briefing unavailable">
              <AIInsightsPanel
                activeCount={activeCount} scheduledCount={scheduledCount}
                lateSinceOpen={lateSinceOpen} salesVsGoalPct={salesVsGoalPct}
                openIssues={issues.length} openTasks={openTaskCount}
                payrollHealthPct={payrollHealthPct} topPerformer={topPerformerName}
                dayOfWeek={format(now, 'EEEE')} onNavigate={(p) => navigate(p)} />
            </DashboardErrorBoundary>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-muted-foreground" /> Coming up this week
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DashboardErrorBoundary fallback="Schedule unavailable">
              <ComingUpPanel weekSchedules={weekSchedules} locations={locations} users={users} onNavigate={(p) => navigate(p)} />
            </DashboardErrorBoundary>
          </CardContent>
        </Card>
      </div>

      {/* ── TASKS / TRAINING / RITUALS ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <CheckSquare className="h-4 w-4 text-muted-foreground" /> Tasks &amp; SOPs
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DashboardErrorBoundary fallback="Task data unavailable">
              <TasksSOPMini tasks={tasks} scores={gamificationScores} onNavigate={(p) => navigate(p)} />
            </DashboardErrorBoundary>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Trophy className="h-4 w-4 text-muted-foreground" /> Training
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DashboardErrorBoundary fallback="Training data unavailable">
              <TrainingMini scores={gamificationScores} onNavigate={(p) => navigate(p)} />
            </DashboardErrorBoundary>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Sun className="h-4 w-4 text-muted-foreground" /> Daily rituals
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DashboardErrorBoundary fallback="Ritual data unavailable">
              <DailyRitualsMini
                huddleStatus={huddleStatus}
                huddleLedByName={huddleLedByName}
                openingChecklistCompleter={openingChecklistCompleter}
                middayPulseExists={middayPulseExists}
                debriefCount={debriefCount}
                onNavigate={(p) => navigate(p)}
              />
            </DashboardErrorBoundary>
          </CardContent>
        </Card>
      </div>

      {/* ── CASH STATUS ───────────────────────────────────────────────────── */}
      <DashboardErrorBoundary fallback="Cash status unavailable">
        <CashStatusCard />
      </DashboardErrorBoundary>

    </div>
  );
}
