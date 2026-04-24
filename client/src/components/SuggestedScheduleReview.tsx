import { useState, useMemo, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { X, Check, Pencil, Loader2, TrendingUp, Sparkles, AlertTriangle } from "lucide-react";

interface HourlyData {
  hour: number;
  label: string;
  revenue: number;
  isPeak: boolean;
  suggestedStaff: number;
}

interface ProposedShift {
  employeeId: string;
  employeeName: string;
  profileImageUrl: string | null;
  startTime: string;
  endTime: string;
  shiftBlock: string;
  rationale: string;
  revenue: number;
}

interface SuggestedScheduleData {
  date: string;
  proposedShifts: ProposedShift[];
  historicalDate: string;
  dataSource: string;
  hourlyData: HourlyData[];
  storeHours: { open: string; close: string };
}

interface Props {
  data: SuggestedScheduleData | null;
  isLoading: boolean;
  onClose: () => void;
  onApproveAll?: (shifts: ProposedShift[]) => void;
  onEditShift?: (shift: ProposedShift & { index: number }) => void;
  onRegenerate?: () => void;
  fromCache?: boolean;
}

function SalesSpark({ hourlyData, storeHours }: { hourlyData: HourlyData[]; storeHours: { open: string; close: string } }) {
  if (!hourlyData || hourlyData.length === 0) return null;
  const maxRev = Math.max(...hourlyData.map(h => h.revenue), 1);
  const H = 48;
  const W_total = hourlyData.length;

  return (
    <div className="mb-4">
      <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
        <TrendingUp className="h-3.5 w-3.5" />
        Historical Sales (last year equivalent day)
        <span className="ml-auto flex gap-2 text-[10px]">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-violet-400/60" />normal</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-violet-600" />peak</span>
        </span>
      </div>
      <div className="flex items-end gap-px h-12 bg-muted/30 rounded-lg p-1 overflow-hidden">
        {hourlyData.map((slot, i) => {
          const h = (slot.revenue / maxRev) * H;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end group relative" style={{ height: H }}>
              {slot.revenue > 0 && (
                <div
                  className={cn("w-full rounded-sm transition-all", slot.isPeak ? "bg-violet-600" : "bg-violet-400/60")}
                  style={{ height: `${Math.max(2, h)}px` }}
                  title={`${slot.label}: $${Math.round(slot.revenue).toLocaleString()}${slot.isPeak ? ' (peak)' : ''}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-muted-foreground">{hourlyData[0]?.label}</span>
        <span className="text-[10px] text-muted-foreground">{hourlyData[hourlyData.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function ShiftAvatar({ shift }: { shift: ProposedShift }) {
  const initials = shift.employeeName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const colors = ['bg-violet-500','bg-blue-500','bg-emerald-500','bg-amber-500','bg-rose-500'];
  let hash = 0;
  for (let i = 0; i < shift.employeeName.length; i++) hash = shift.employeeName.charCodeAt(i) + ((hash << 5) - hash);
  const color = colors[Math.abs(hash) % colors.length];
  if (shift.profileImageUrl) {
    return <img src={shift.profileImageUrl} alt={shift.employeeName} className="w-8 h-8 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0", color)}>
      {initials}
    </div>
  );
}

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

export default function SuggestedScheduleReview({ data, isLoading, onClose, onApproveAll, onEditShift, onRegenerate, fromCache }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  // Local copy of proposed shifts — edits are kept as proposals until Approve All commits them.
  // Never mutate the `data` prop directly.
  const [localShifts, setLocalShifts] = useState<ProposedShift[]>(() => data?.proposedShifts ?? []);

  // Sync local shifts when data prop changes (e.g. new suggestion generated)
  useEffect(() => {
    if (data?.proposedShifts) setLocalShifts(data.proposedShifts);
  }, [data?.proposedShifts]);

  const applyMutation = useMutation({
    mutationFn: async (shifts: ProposedShift[]) => {
      const entries = shifts.map(s => ({
        employeeId: s.employeeId,
        date: data!.date,
        startTime: s.startTime,
        endTime: s.endTime,
        shiftBlock: s.shiftBlock,
        reasoning: s.rationale,
      }));
      return apiRequest('POST', '/api/ai-scheduling/apply', { scheduleEntries: entries });
    },
    onSuccess: async (response: any, shifts: ProposedShift[]) => {
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ['/api/schedules'] });
      queryClient.invalidateQueries({ queryKey: ['/api/schedules/today-availability'] });
      toast({ title: "Schedule Applied", description: `${result.schedulesCreated} shifts created.` });
      onApproveAll?.(shifts);
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to apply schedule.", variant: "destructive" });
    },
  });

  // Active shifts = local shifts excluding cards the manager removed
  const activeShifts = useMemo(() => {
    return localShifts.filter((_, i) => !removedIndices.has(i));
  }, [localShifts, removedIndices]);

  const toggleRemove = (idx: number) => {
    setRemovedIndices(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const startEdit = (idx: number, shift: ProposedShift) => {
    // Enter inline edit mode — no shift is saved until Approve All.
    // onEditShift is intentionally NOT called here; shifts remain proposals.
    setEditingIdx(idx);
    setEditStart(shift.startTime);
    setEditEnd(shift.endTime);
  };

  const saveEdit = () => {
    if (editingIdx === null) return;
    // Update local state immutably — does NOT persist to backend
    setLocalShifts(prev => prev.map((s, i) =>
      i === editingIdx ? { ...s, startTime: editStart, endTime: editEnd } : s
    ));
    setEditingIdx(null);
  };

  const dateLabel = data?.date
    ? new Date(data.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : '';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[96vw] max-w-4xl h-[92vh] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <div>
              <h2 className="font-semibold text-sm">AI Suggested Schedule</h2>
              <p className="text-xs text-muted-foreground">{dateLabel}{fromCache && ' · saved'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fromCache && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                title="Clear saved schedule and generate a fresh one"
              >
                Regenerate
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Generating suggested schedule…</span>
            </div>
          ) : !data ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No data available.</div>
          ) : (
            <>
              {/* Data source badge */}
              {data.dataSource === 'synthetic' && (
                <div className="flex items-center gap-2 mb-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  No Shopify sales data found. Staffing recommendations use minimum defaults.
                </div>
              )}
              {data.historicalDate && data.dataSource !== 'synthetic' && (
                <p className="text-[11px] text-muted-foreground mb-3">
                  Sales data from {new Date(data.historicalDate + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} (equivalent day last year)
                </p>
              )}

              {/* Sales Sparkline */}
              <SalesSpark hourlyData={data.hourlyData} storeHours={data.storeHours} />

              {/* Shift Cards */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground mb-1">Proposed Shifts ({activeShifts.length} of {localShifts.length})</div>
                {localShifts.length === 0 && (
                  <p className="text-sm text-muted-foreground italic py-4 text-center">
                    No available staff to fill shifts. Add employees or adjust their availability.
                  </p>
                )}
                {localShifts.map((shift, idx) => {
                  const isRemoved = removedIndices.has(idx);
                  const isEditing = editingIdx === idx;
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "border rounded-lg p-3 transition-all",
                        isRemoved ? "opacity-40 bg-muted border-border/40 line-through" : "bg-background border-border"
                      )}
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-2">
                            <ShiftAvatar shift={shift} />
                            <span className="text-sm font-medium">{shift.employeeName}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Start Time</Label>
                              <Input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} className="h-8 text-sm" />
                            </div>
                            <div>
                              <Label className="text-xs">End Time</Label>
                              <Input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} className="h-8 text-sm" />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setEditingIdx(null)}>Cancel</Button>
                            <Button size="sm" onClick={saveEdit}>Save</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <ShiftAvatar shift={shift} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{shift.employeeName}</span>
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{shift.shiftBlock}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{shift.rationale}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!isRemoved && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Edit shift times"
                                onClick={() => startEdit(idx, shift)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn("h-7 w-7", isRemoved ? "text-emerald-600 hover:text-emerald-700" : "text-muted-foreground hover:text-red-500")}
                              title={isRemoved ? "Restore" : "Remove"}
                              onClick={() => toggleRemove(idx)}
                            >
                              {isRemoved ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isLoading && data && (
          <div className="flex items-center justify-between px-5 py-3 border-t flex-shrink-0 bg-muted/20">
            <span className="text-xs text-muted-foreground">
              {activeShifts.length} shift{activeShifts.length !== 1 ? 's' : ''} will be created
              {removedIndices.size > 0 && ` (${removedIndices.size} removed)`}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Discard
              </Button>
              <Button
                size="sm"
                className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                disabled={applyMutation.isPending || activeShifts.length === 0}
                onClick={() => applyMutation.mutate(activeShifts)}
              >
                {applyMutation.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Applying…</>
                ) : (
                  <><Check className="h-3.5 w-3.5" />Approve All ({activeShifts.length})</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
