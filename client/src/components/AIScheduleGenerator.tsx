import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  BrainCircuit, DollarSign, Users, Loader2,
  Check, AlertTriangle, ChevronDown, ChevronUp, Sparkles,
  ShieldCheck, Settings2, CalendarDays, RefreshCw, Zap,
} from 'lucide-react';
import ScheduleReviewModal, { type ReviewResult, ratingConfig } from '@/components/ScheduleReviewModal';

interface ScheduleEntry {
  date: string;
  employeeId: string;
  employeeName: string;
  shiftBlock: string;
  startTime: string;
  endTime: string;
  reasoning: string;
}

interface DayPrediction {
  date: string;
  dayOfWeek: number;
  dayName: string;
  predictedRevenue: number;
  requiredStaff: number;
  requiredStaffPre?: number;
  requiredStaffDuring?: number;
  requiredStaffPost?: number;
  matchedLastYearDate?: string;
}

interface DailyLaborCostWarning {
  date: string;
  laborCost: number;
  projectedRevenue: number;
  laborCostPercent: number;
  type: "over" | "under";
  message: string;
}

interface LaborCostBand {
  overPct: number;
  underPct: number;
}

interface GenerateResult {
  success: boolean;
  days: DayPrediction[];
  generatedSchedule: ScheduleEntry[];
  summary: string;
  warnings: string[];
  dailyLaborCostWarnings?: DailyLaborCostWarning[];
  laborCostBand?: LaborCostBand;
  settings: any;
  salesDataAvailable: boolean;
}

interface PrebuildStatus {
  prebuiltDates: Array<{ date: string; generatedAt: string | null }>;
  rangeStart: string;
  rangeEnd: string;
  total: number;
}

function getWeekLabel(startDate: Date): string {
  const end = new Date(startDate);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(startDate)} – ${fmt(end)}`;
}

function getNext4Weeks(): Array<{ label: string; dates: string[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weeks = [];
  for (let w = 0; w < 4; w++) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + w * 7);
    const dates: string[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      dates.push(day.toISOString().split('T')[0]);
    }
    weeks.push({ label: getWeekLabel(weekStart), dates });
  }
  return weeks;
}

export default function AIScheduleGenerator() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 13);
    return d.toISOString().split('T')[0];
  });
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [removedEntries, setRemovedEntries] = useState<Set<number>>(new Set());
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  const { data: connectedShops = [] } = useQuery<any[]>({
    queryKey: ['/api/shopify/shops'],
  });

  const { data: aiSettings } = useQuery<any>({
    queryKey: ['/api/ai-scheduling/settings'],
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeStart = today.toISOString().split('T')[0];
  const rangeEndDate = new Date(today);
  rangeEndDate.setDate(today.getDate() + 27);
  const rangeEnd = rangeEndDate.toISOString().split('T')[0];

  const { data: prebuildStatus, refetch: refetchStatus } = useQuery<PrebuildStatus>({
    queryKey: ['/api/ai-scheduling/prebuild-status', rangeStart, rangeEnd],
    queryFn: async () => {
      const res = await fetch(`/api/ai-scheduling/prebuild-status?startDate=${rangeStart}&endDate=${rangeEnd}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json();
    },
    refetchInterval: false,
  });

  const activeShop = connectedShops.find((s: any) => s.isActive);

  const settingsBand: LaborCostBand | null = (() => {
    if (!aiSettings) return null;
    const over = Number(aiSettings.laborCostOverPct ?? aiSettings.labor_cost_over_pct ?? 30);
    const under = Number(aiSettings.laborCostUnderPct ?? aiSettings.labor_cost_under_pct ?? 10);
    if (!Number.isFinite(over) || !Number.isFinite(under)) return null;
    return { overPct: over, underPct: under };
  })();

  const generateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/ai-scheduling/generate', {
        startDate,
        endDate,
        shopDomain: activeShop?.shopDomain,
      });
    },
    onSuccess: async (response: any) => {
      const data = await response.json();
      setResult(data);
      setRemovedEntries(new Set());
      setReviewResult(null);
      toast({ title: "Schedule Generated", description: data.summary || "AI schedule is ready for review." });
    },
    onError: (error: any) => {
      toast({ title: "Generation Failed", description: error.message || "Failed to generate schedule.", variant: "destructive" });
    },
  });

  const prebuildMutation = useMutation({
    mutationFn: async (force = false) => {
      const res = await apiRequest('POST', '/api/ai-scheduling/prebuild', { force });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Pre-build Complete", description: data.message || `${data.daysPrebuilt} days pre-built.` });
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['/api/schedules/suggest'] });
    },
    onError: (error: any) => {
      toast({ title: "Pre-build Failed", description: error.message || "Failed to pre-build schedules.", variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/ai-scheduling/prebuild', { force: true });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Schedules Regenerated", description: data.message || `${data.daysPrebuilt} days rebuilt.` });
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['/api/schedules/suggest'] });
    },
    onError: (error: any) => {
      toast({ title: "Regeneration Failed", description: error.message || "Failed to regenerate.", variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('No schedule to apply');
      const entries = result.generatedSchedule.filter((_, i) => !removedEntries.has(i));
      return apiRequest('POST', '/api/ai-scheduling/apply', { scheduleEntries: entries });
    },
    onSuccess: async (response: any) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ['/api/schedules'] });
      toast({ title: "Schedule Applied", description: `${data.schedulesCreated} shifts have been created.` });
      setResult(null);
      setReviewResult(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to apply schedule.", variant: "destructive" });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('No schedule to review');
      const entries = result.generatedSchedule.filter((_, i) => !removedEntries.has(i));
      return apiRequest('POST', '/api/ai-scheduling/review', {
        scheduleEntries: entries,
        startDate,
        endDate,
        days: result.days,
      });
    },
    onSuccess: async (response: any) => {
      const data: ReviewResult = await response.json();
      setReviewResult(data);
      setShowReviewModal(true);
    },
    onError: () => {
      toast({ title: "Review Failed", description: "Failed to audit the schedule. Please try again.", variant: "destructive" });
    },
  });

  const toggleDay = (date: string) => {
    const next = new Set(expandedDays);
    next.has(date) ? next.delete(date) : next.add(date);
    setExpandedDays(next);
  };

  const toggleRemoveEntry = (index: number) => {
    const next = new Set(removedEntries);
    next.has(index) ? next.delete(index) : next.add(index);
    setRemovedEntries(next);
  };

  const activeEntries = result ? result.generatedSchedule.filter((_, i) => !removedEntries.has(i)) : [];

  const getEntriesForDate = (date: string) => {
    if (!result) return [];
    return result.generatedSchedule
      .map((entry, index) => ({ ...entry, originalIndex: index }))
      .filter(e => e.date === date);
  };

  const weeks = getNext4Weeks();
  const prebuiltSet = new Set((prebuildStatus?.prebuiltDates || []).map(d => d.date));
  const totalDays = 28;
  const prebuiltCount = prebuildStatus?.total ?? 0;
  const isPrebuildPending = prebuildMutation.isPending || regenerateMutation.isPending;

  return (
    <div className="space-y-6">

      {/* ── Smart Pre-build Card ─────────────────────────────────────────── */}
      <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-primary" />
            Smart Pre-build — Next 4 Weeks
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generate AI suggestions once for the entire month and save them. When any manager opens the create shift panel, suggestions are already there — no extra AI calls needed.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Coverage grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {weeks.map((week, wi) => {
              const prebuiltInWeek = week.dates.filter(d => prebuiltSet.has(d)).length;
              const allDone = prebuiltInWeek === 7;
              const noneDone = prebuiltInWeek === 0;
              return (
                <div
                  key={wi}
                  className={`rounded-lg border p-3 text-center ${
                    allDone
                      ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/30'
                      : noneDone
                      ? 'border-muted bg-muted/30'
                      : 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
                  }`}
                >
                  <p className="text-xs font-medium text-muted-foreground truncate">{week.label}</p>
                  <div className="mt-1">
                    {allDone ? (
                      <Badge variant="outline" className="text-green-700 border-green-400 dark:text-green-400 gap-1 text-xs">
                        <Check className="h-3 w-3" /> Ready
                      </Badge>
                    ) : noneDone ? (
                      <Badge variant="outline" className="text-muted-foreground text-xs">
                        Not built
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-700 border-amber-400 dark:text-amber-400 text-xs">
                        {prebuiltInWeek}/7 days
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary + actions */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {prebuiltCount === 0
                ? 'No suggestions pre-built yet.'
                : `${prebuiltCount} of ${totalDays} days have pre-built suggestions.`}
            </p>
            <div className="flex gap-2 flex-wrap">
              {prebuiltCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => regenerateMutation.mutate()}
                  disabled={isPrebuildPending}
                >
                  {regenerateMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Regenerate All
                </Button>
              )}
              <Button
                size="sm"
                className="gap-2"
                onClick={() => prebuildMutation.mutate(false)}
                disabled={isPrebuildPending}
              >
                {prebuildMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Building... (takes ~30s)
                  </>
                ) : (
                  <>
                    <CalendarDays className="h-3.5 w-3.5" />
                    {prebuiltCount === 0 ? 'Pre-build Next 4 Weeks' : 'Fill Missing Days'}
                  </>
                )}
              </Button>
            </div>
          </div>

          {isPrebuildPending && (
            <div className="rounded-md bg-primary/10 border border-primary/20 px-3 py-2 text-sm text-primary">
              AI is generating and saving shift suggestions for each day. This may take up to a minute…
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Manual Week Generator ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            AI Schedule Generator
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generate an optimized schedule for a specific date range, review shift-by-shift, then apply or publish.
            {!activeShop && (
              <span className="text-amber-600 dark:text-amber-400 block mt-1">
                No Shopify store connected. The AI will use minimum staffing levels. Connect your store in Settings &gt; POS connection for sales-based predictions.
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-44"
              />
            </div>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="gap-2"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Schedule
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
            <BrainCircuit className="h-3.5 w-3.5" />
            AI considers employee availability, target hours, and performance scores when assigning shifts.
          </p>
        </CardContent>
      </Card>

      {result && (() => {
        const dailyWarnings = result.dailyLaborCostWarnings ?? [];
        const dailyMessages = new Set(dailyWarnings.map(w => w.message));
        const otherWarnings = (result.warnings ?? []).filter(w => !dailyMessages.has(w));
        const band = result.laborCostBand ?? settingsBand;
        return (
        <>
          {otherWarnings.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    {otherWarnings.map((w, i) => (
                      <p key={i} className="text-sm text-amber-700 dark:text-amber-300">{w}</p>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {dailyWarnings.length > 0 && (
            <Card
              className="border-amber-200 dark:border-amber-800"
              data-testid="card-daily-labor-cost-warnings"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <CardTitle className="text-base">Daily labor cost warnings</CardTitle>
                      {band && (
                        <p
                          className="text-xs text-muted-foreground mt-1"
                          data-testid="text-labor-cost-band"
                        >
                          Evaluated against your target band:{' '}
                          <strong>{band.underPct}%</strong> – <strong>{band.overPct}%</strong> of projected revenue
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {band && (
                      <Badge
                        variant="outline"
                        className="gap-1"
                        data-testid="badge-labor-cost-band"
                      >
                        {band.underPct}% / {band.overPct}% target
                      </Badge>
                    )}
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs gap-1"
                      onClick={() => {
                        const target = typeof document !== 'undefined'
                          ? document.getElementById('labor-cost-band')
                          : null;
                        if (target) {
                          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          if (typeof window !== 'undefined' && window.history?.replaceState) {
                            window.history.replaceState(null, '', '#labor-cost-band');
                          }
                        } else {
                          navigate('/admin?section=ai-scheduling#labor-cost-band');
                        }
                      }}
                      data-testid="button-adjust-labor-cost-band"
                    >
                      <Settings2 className="h-3 w-3" />
                      Adjust band
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {dailyWarnings.map((w) => (
                  <div
                    key={w.date}
                    className="flex items-start justify-between gap-2 text-sm"
                    data-testid={`row-daily-labor-cost-${w.date}`}
                  >
                    <p className="text-amber-700 dark:text-amber-300 flex-1">{w.message}</p>
                    <Badge
                      variant={w.type === 'over' ? 'destructive' : 'secondary'}
                      className="shrink-0"
                    >
                      {w.laborCostPercent}%
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {reviewResult && (
            <Card className={`border ${ratingConfig[reviewResult.overallRating].bg}`}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={ratingConfig[reviewResult.overallRating].color}>
                    {ratingConfig[reviewResult.overallRating].icon}
                  </span>
                  <span className={`font-medium ${ratingConfig[reviewResult.overallRating].color}`}>
                    Schedule Review: {ratingConfig[reviewResult.overallRating].label}
                  </span>
                  {reviewResult.issues.length > 0 && (
                    <Badge variant="outline" className="ml-auto">
                      {reviewResult.issues.length} issue{reviewResult.issues.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{reviewResult.coverageAssessment}</p>
                <Button
                  variant="link"
                  size="sm"
                  className="px-0 text-xs mt-1"
                  onClick={() => setShowReviewModal(true)}
                >
                  View full report
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue Predictions & Staffing</CardTitle>
              <p className="text-sm text-muted-foreground">
                {result.salesDataAvailable
                  ? "Revenue predictions based on last year's sales matched by closest day of week."
                  : "No sales data available. Using minimum staffing levels."}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {result.days.map(day => {
                  const dayEntries = getEntriesForDate(day.date);
                  const activeCount = dayEntries.filter(e => !removedEntries.has(e.originalIndex)).length;
                  const isExpanded = expandedDays.has(day.date);

                  return (
                    <div key={day.date} className="border rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleDay(day.date)}
                        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-24">
                            <div className="font-medium text-sm">{day.dayName}</div>
                            <div className="text-xs text-muted-foreground">{day.date}</div>
                          </div>
                          {result.salesDataAvailable && (
                            <Badge variant="outline" className="gap-1">
                              <DollarSign className="h-3 w-3" />
                              ${day.predictedRevenue.toLocaleString()}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="gap-1" title={day.requiredStaffPre != null ? `Opening: ${day.requiredStaffPre} · Peak: ${day.requiredStaffDuring} · Closing: ${day.requiredStaffPost}` : undefined}>
                            <Users className="h-3 w-3" />
                            {day.requiredStaffDuring ?? day.requiredStaff} peak needed
                          </Badge>
                          <Badge
                            variant={activeCount >= (day.requiredStaffDuring ?? day.requiredStaff) ? "default" : "destructive"}
                            className="gap-1"
                          >
                            {activeCount} assigned
                          </Badge>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>

                      {isExpanded && (
                        <div className="border-t bg-muted/20 p-3 space-y-2">
                          {day.matchedLastYearDate && (
                            <p className="text-xs text-muted-foreground">
                              Based on sales from {day.matchedLastYearDate} (closest {day.dayName} last year)
                            </p>
                          )}
                          {dayEntries.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic">No shifts assigned</p>
                          ) : (
                            dayEntries.map((entry) => {
                              const isRemoved = removedEntries.has(entry.originalIndex);
                              return (
                                <div
                                  key={entry.originalIndex}
                                  className={`flex items-center justify-between p-2 rounded-md border ${isRemoved ? 'opacity-40 bg-muted line-through' : 'bg-background'}`}
                                >
                                  <div className="flex items-center gap-3">
                                    <div>
                                      <div className="font-medium text-sm">{entry.employeeName}</div>
                                      <div className="text-xs text-muted-foreground">
                                        {entry.shiftBlock}: {entry.startTime} - {entry.endTime}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground max-w-48 truncate hidden sm:inline">
                                      {entry.reasoning}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); toggleRemoveEntry(entry.originalIndex); }}
                                      className="h-7 text-xs"
                                    >
                                      {isRemoved ? 'Restore' : 'Remove'}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {result.summary && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm">{result.summary}</p>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {activeEntries.length} shifts will be created ({removedEntries.size} removed)
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setResult(null); setReviewResult(null); }}>
                Discard
              </Button>
              <Button
                variant="outline"
                onClick={() => reviewMutation.mutate()}
                disabled={reviewMutation.isPending || activeEntries.length === 0}
                className="gap-2 border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/20"
              >
                {reviewMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reviewing...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    Review before publishing
                  </>
                )}
              </Button>
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending || activeEntries.length === 0}
                className="gap-2"
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Apply Schedule ({activeEntries.length} shifts)
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
        );
      })()}

      {/* Schedule Review Modal */}
      <ScheduleReviewModal
        open={showReviewModal}
        onOpenChange={setShowReviewModal}
        reviewResult={reviewResult}
        activeEntriesCount={activeEntries.length}
        onApply={() => applyMutation.mutate()}
        isApplying={applyMutation.isPending}
      />
    </div>
  );
}
