import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Zap, ChevronDown, ChevronUp, Users, TrendingUp, AlertTriangle, Sparkles } from "lucide-react";

interface Member {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  roleName: string;
  isAvailable: boolean;
  availableFrom: string | null;
  availableTo: string | null;
  overlapHours: number;
  compositeScore: number;
  performanceScore: number;
  scheduledHoursThisWeek: number;
  targetWeeklyHours: number | null;
  source: string;
}

interface CoverageHour {
  hour: number;
  label: string;
  available: number;
  scheduled: number;
}

interface AvailabilityData {
  date: string;
  storeHours: { open: string; close: string; isClosed: boolean } | null;
  members: Member[];
  coverage: CoverageHour[];
  readinessPct: number;
}

interface Props {
  date: string;
  onQuickAdd: (member: Member, startTime: string, endTime: string) => void;
  onGapClick: (startTime: string, endTime: string, topMember: Member | null) => void;
  onAIAutoSchedule: () => void;
}

function ScoreBadge({ score }: { score: number }) {
  if (score >= 85) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-400 text-yellow-900 text-[10px] font-bold shrink-0" title={`Score: ${score}`}>
      {score}
    </span>
  );
  if (score >= 60) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 text-slate-700 text-[10px] font-bold shrink-0" title={`Score: ${score}`}>
      {score}
    </span>
  );
  if (score >= 35) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/30 text-amber-900 dark:text-amber-200 text-[10px] font-bold shrink-0" title={`Score: ${score}`}>
      {score}
    </span>
  );
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-[10px] font-bold shrink-0" title={`Score: ${score}`}>
      {score}
    </span>
  );
}

function Avatar({ member, size = "sm" }: { member: Member; size?: "sm" | "md" }) {
  const sz = size === "md" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";
  const initials = ((member.firstName?.[0] || '') + (member.lastName?.[0] || '')).toUpperCase() || '?';
  const colors = ['bg-violet-500','bg-blue-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'];
  let hash = 0;
  for (let i = 0; i < member.name.length; i++) hash = member.name.charCodeAt(i) + ((hash << 5) - hash);
  const color = colors[Math.abs(hash) % colors.length];
  if (member.profileImageUrl) {
    return <img src={member.profileImageUrl} alt={member.name} className={cn(sz, "rounded-full object-cover shrink-0")} />;
  }
  return (
    <div className={cn(sz, "rounded-full flex items-center justify-center text-white font-bold shrink-0", color)}>
      {initials}
    </div>
  );
}

function MiniAvailBar({ member, storeOpen, storeClose }: { member: Member; storeOpen: string; storeClose: string }) {
  if (!member.isAvailable || !member.availableFrom || !member.availableTo) return null;
  function t2m(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); }
  const openMins = t2m(storeOpen);
  const closeMins = t2m(storeClose);
  const total = closeMins - openMins;
  if (total <= 0) return null;
  const from = Math.max(t2m(member.availableFrom), openMins);
  const to = Math.min(t2m(member.availableTo), closeMins);
  const startPct = ((from - openMins) / total) * 100;
  const widthPct = Math.max(0, ((to - from) / total) * 100);
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className="h-full bg-emerald-500 rounded-full"
        style={{ marginLeft: `${startPct}%`, width: `${widthPct}%` }}
      />
    </div>
  );
}

function CoverageTimeline({ coverage, storeHours, onGapClick, members }: {
  coverage: CoverageHour[];
  storeHours: { open: string; close: string } | null;
  onGapClick: (startTime: string, endTime: string, topMember: Member | null) => void;
  members: Member[];
}) {
  if (!coverage || coverage.length === 0) return null;
  const maxVal = Math.max(...coverage.map(c => Math.max(c.available, 1)));

  return (
    <div className="mb-3">
      <div className="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
        <TrendingUp className="h-3 w-3" />
        Coverage Timeline
        <span className="ml-auto flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2 rounded-sm bg-blue-400/60" />available
          <span className="inline-block w-2.5 h-2 rounded-sm bg-emerald-500" />scheduled
        </span>
      </div>
      <div className="flex gap-px items-end" style={{ height: 36 }}>
        {coverage.map((slot, i) => {
          const availH = (slot.available / maxVal) * 32;
          const schedH = (slot.scheduled / maxVal) * 32;
          const isGap = slot.available > 0 && slot.scheduled === 0;
          const isLow = slot.available > 0 && slot.scheduled > 0 && slot.scheduled < slot.available * 0.5;
          const gapColor = isGap ? 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 cursor-pointer hover:bg-red-200' : isLow ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 cursor-pointer hover:bg-amber-100' : '';
          const startH = slot.hour;
          const endH = slot.hour + 1;
          const startTime = `${String(startH).padStart(2, '0')}:00`;
          const endTime = `${String(endH).padStart(2, '0')}:00`;
          const gapTopMember = members
            .filter(m => {
              if (!m.availableFrom || !m.availableTo) return true;
              const mFromH = parseInt(m.availableFrom.split(':')[0], 10);
              const mToH = parseInt(m.availableTo.split(':')[0], 10);
              return mFromH <= startH && mToH >= endH;
            })
            .sort((a, b) => b.compositeScore - a.compositeScore)[0] ?? null;
          return (
            <button
              key={i}
              title={`${slot.label}: ${slot.scheduled} scheduled / ${slot.available} available`}
              onClick={() => (isGap || isLow) && onGapClick(startTime, endTime, gapTopMember)}
              className={cn("flex-1 flex flex-col justify-end rounded-sm overflow-hidden relative", (isGap || isLow) && "cursor-pointer")}
              style={{ height: 36 }}
            >
              {(isGap || isLow) && (
                <div className={cn("absolute inset-0 rounded-sm", isGap ? "bg-red-100 dark:bg-red-900/20" : "bg-amber-50 dark:bg-amber-900/10")} />
              )}
              <div className="relative z-10 flex flex-col justify-end" style={{ height: 32 }}>
                <div className="w-full bg-blue-400/50 rounded-sm" style={{ height: `${Math.round(availH)}px` }} />
                {slot.scheduled > 0 && (
                  <div
                    className="w-full bg-emerald-500 rounded-sm absolute bottom-0"
                    style={{ height: `${Math.round(schedH)}px` }}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-muted-foreground">{storeHours?.open}</span>
        <span className="text-[9px] text-muted-foreground">{storeHours?.close}</span>
      </div>
    </div>
  );
}

function EmployeeCard({ member, storeHours, onQuickAdd }: {
  member: Member;
  storeHours: { open: string; close: string } | null;
  onQuickAdd: (member: Member, startTime: string, endTime: string) => void;
}) {
  function fmt(t: string) {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
  }

  const startTime = member.availableFrom || storeHours?.open || '09:00';
  const endTime = member.availableTo || storeHours?.close || '17:00';
  const windowLabel = member.availableFrom && member.availableTo
    ? `${fmt(member.availableFrom)} – ${fmt(member.availableTo)}`
    : 'All day';

  return (
    <div className={cn(
      "flex items-center gap-2 py-1.5 px-2 rounded-lg border transition-all",
      member.isAvailable
        ? "bg-background border-border hover:bg-muted/30"
        : "bg-muted/30 border-border/40 opacity-50"
    )}>
      <Avatar member={member} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{member.name}</span>
          <ScoreBadge score={member.compositeScore} />
        </div>
        <div className="text-[10px] text-muted-foreground truncate">{member.roleName}</div>
        {member.isAvailable && (
          <>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{windowLabel}</div>
            <MiniAvailBar member={member} storeOpen={storeHours?.open || '09:00'} storeClose={storeHours?.close || '21:00'} />
          </>
        )}
        {!member.isAvailable && (
          <div className="text-[10px] text-muted-foreground italic">
            {member.source === 'time_off' ? 'Time off' : 'Not available'}
          </div>
        )}
      </div>
      {member.isAvailable && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-primary hover:bg-primary/10"
          title="Quick-add shift"
          onClick={() => onQuickAdd(member, startTime, endTime)}
        >
          <Zap className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export default function AvailabilityCommandPanel({ date, onQuickAdd, onGapClick, onAIAutoSchedule }: Props) {
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();

  const [showUnavailable, setShowUnavailable] = useState(() => {
    try { return localStorage.getItem('cmdPanel_showUnavailable') === 'true'; } catch { return false; }
  });
  const [roleFilter, setRoleFilter] = useState(() => {
    try { return localStorage.getItem('cmdPanel_roleFilter') || 'all'; } catch { return 'all'; }
  });
  const [minScore, setMinScore] = useState(() => {
    try { return parseInt(localStorage.getItem('cmdPanel_minScore') || '0', 10); } catch { return 0; }
  });
  const [minHours, setMinHours] = useState(() => {
    try { return parseFloat(localStorage.getItem('cmdPanel_minHours') || '0'); } catch { return 0; }
  });

  useEffect(() => {
    try { localStorage.setItem('cmdPanel_showUnavailable', String(showUnavailable)); } catch {}
  }, [showUnavailable]);
  useEffect(() => {
    try { localStorage.setItem('cmdPanel_roleFilter', roleFilter); } catch {}
  }, [roleFilter]);
  useEffect(() => {
    try { localStorage.setItem('cmdPanel_minScore', String(minScore)); } catch {}
  }, [minScore]);
  useEffect(() => {
    try { localStorage.setItem('cmdPanel_minHours', String(minHours)); } catch {}
  }, [minHours]);

  const { data, isLoading, refetch } = useQuery<AvailabilityData>({
    queryKey: ['/api/schedules/today-availability', date],
    queryFn: async () => {
      const res = await fetch(`/api/schedules/today-availability?date=${date}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Real-time re-ranking via shared WebSocket context
  useEffect(() => {
    if (!lastMessage) return;
    if (['availability_updated', 'schedule_created', 'schedule_deleted', 'schedule_updated'].includes(lastMessage.type)) {
      queryClient.invalidateQueries({ queryKey: ['/api/schedules/today-availability', date] });
    }
  }, [lastMessage, date, queryClient]);

  const roles = useMemo(() => {
    if (!data?.members) return [];
    return Array.from(new Set(data.members.map(m => m.roleName))).sort();
  }, [data?.members]);

  const filteredMembers = useMemo(() => {
    if (!data?.members) return [];
    return data.members.filter(m => {
      if (roleFilter !== 'all' && m.roleName !== roleFilter) return false;
      if (m.compositeScore < minScore) return false;
      if (minHours > 0 && m.overlapHours < minHours) return false;
      return true;
    });
  }, [data?.members, roleFilter, minScore, minHours]);

  const availableMembers = filteredMembers.filter(m => m.isAvailable);
  const unavailableMembers = filteredMembers.filter(m => !m.isAvailable);

  const readinessPct = data?.readinessPct ?? 0;
  const readinessColor = readinessPct < 30 ? 'text-red-600 dark:text-red-400' : readinessPct < 60 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';

  if (isLoading) {
    return (
      <div className="p-3 space-y-3">
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded" />
        {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Users className="h-4 w-4 text-primary" />
            Today's Intelligence
          </span>
          <div className="flex items-center gap-1.5">
            <div className={cn("text-xs font-bold", readinessColor)}>
              {readinessPct}% ready
            </div>
            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", readinessPct < 30 ? "bg-red-500" : readinessPct < 60 ? "bg-amber-500" : "bg-emerald-500")}
                style={{ width: `${Math.min(100, readinessPct)}%` }}
              />
            </div>
          </div>
        </div>

        {data.storeHours?.isClosed ? (
          <div className="text-xs text-muted-foreground italic">Store is closed today</div>
        ) : null}

        {/* Coverage Timeline */}
        {data.coverage && data.coverage.length > 0 && (
          <CoverageTimeline
            coverage={data.coverage}
            storeHours={data.storeHours}
            onGapClick={onGapClick}
            members={availableMembers}
          />
        )}

        {/* AI Auto-Schedule Button */}
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1.5 text-xs border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 mb-2"
          onClick={onAIAutoSchedule}
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Auto-Schedule
        </Button>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {roles.length > 1 && (
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-6 text-[10px] w-auto min-w-[80px] px-2 border-border/60">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={String(minScore)} onValueChange={v => setMinScore(Number(v))}>
            <SelectTrigger className="h-6 text-[10px] w-auto min-w-[80px] px-2 border-border/60">
              <SelectValue placeholder="Min score" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any score</SelectItem>
              <SelectItem value="35">≥35 (Bronze+)</SelectItem>
              <SelectItem value="60">≥60 (Silver+)</SelectItem>
              <SelectItem value="85">≥85 (Gold)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(minHours)} onValueChange={v => setMinHours(Number(v))}>
            <SelectTrigger className="h-6 text-[10px] w-auto min-w-[80px] px-2 border-border/60">
              <SelectValue placeholder="Min hrs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any hrs</SelectItem>
              <SelectItem value="2">≥2 hrs</SelectItem>
              <SelectItem value="4">≥4 hrs</SelectItem>
              <SelectItem value="6">≥6 hrs</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Employee List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {availableMembers.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4 italic">
            No available staff match the current filters.
          </div>
        )}
        {availableMembers.map(m => (
          <EmployeeCard
            key={m.userId}
            member={m}
            storeHours={data.storeHours}
            onQuickAdd={onQuickAdd}
          />
        ))}

        {unavailableMembers.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowUnavailable(v => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground w-full transition-colors"
            >
              {showUnavailable ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showUnavailable ? 'Hide' : `Show ${unavailableMembers.length} unavailable`}
            </button>
            {showUnavailable && unavailableMembers.map(m => (
              <div key={m.userId} className="mt-1">
                <EmployeeCard
                  member={m}
                  storeHours={data.storeHours}
                  onQuickAdd={onQuickAdd}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
