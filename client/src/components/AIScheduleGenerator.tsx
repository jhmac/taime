import { useState } from 'react';
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
  ShieldCheck,
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
  matchedLastYearDate?: string;
}

interface GenerateResult {
  success: boolean;
  days: DayPrediction[];
  generatedSchedule: ScheduleEntry[];
  summary: string;
  warnings: string[];
  settings: any;
  salesDataAvailable: boolean;
}

export default function AIScheduleGenerator() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
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

  const activeShop = connectedShops.find((s: any) => s.isActive);

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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            AI Schedule Generator
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generate optimized schedules based on last year's sales data, employee availability, and your staffing settings.
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

      {result && (
        <>
          {result.warnings && result.warnings.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    {result.warnings.map((w, i) => (
                      <p key={i} className="text-sm text-amber-700 dark:text-amber-300">{w}</p>
                    ))}
                  </div>
                </div>
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
                          <Badge variant="secondary" className="gap-1">
                            <Users className="h-3 w-3" />
                            {day.requiredStaff} needed
                          </Badge>
                          <Badge
                            variant={activeCount >= day.requiredStaff ? "default" : "destructive"}
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
      )}

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
