import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Trash2, Clock, DollarSign, Users, Save, UserCheck, UserX, Target, Store, Copy, Wand2, CalendarCheck, Loader2 } from 'lucide-react';

interface ShiftBlock {
  name: string;
  startTime: string;
  endTime: string;
}

interface StaffingTier {
  minRevenue: number;
  maxRevenue: number;
  employeeCount: number;
}

interface StoreHourEntry {
  day: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_STORE_HOURS: StoreHourEntry[] = DAY_NAMES.map((_, i) => ({
  day: i,
  openTime: '09:00',
  closeTime: '21:00',
  isClosed: i === 0,
}));

export default function AISchedulingSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ['/api/ai-scheduling/settings'],
  });

  const [shiftBlocks, setShiftBlocks] = useState<ShiftBlock[]>([]);
  const [staffingTiers, setStaffingTiers] = useState<StaffingTier[]>([]);
  const [minimumStaffing, setMinimumStaffing] = useState(2);
  const [storeHours, setStoreHours] = useState<StoreHourEntry[]>(DEFAULT_STORE_HOURS);
  const [shiftOverlapMinutes, setShiftOverlapMinutes] = useState(60);
  const [overlapBudgetLimit, setOverlapBudgetLimit] = useState<number | null>(null);
  const [copyFromDay, setCopyFromDay] = useState<number | null>(null);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const [taskAutoAssign, setTaskAutoAssign] = useState(false);
  const [lastAssignResult, setLastAssignResult] = useState<{ count: number; source: string } | null>(null);

  const { data: companySettings } = useQuery<any>({
    queryKey: ['/api/company-settings'],
  });

  useEffect(() => {
    if (companySettings) {
      setTaskAutoAssign(companySettings.taskAutoAssign ?? false);
    }
  }, [companySettings]);

  const saveTaskAutoAssignMutation = useMutation({
    mutationFn: async (val: boolean) => {
      const res = await apiRequest('PUT', '/api/company-settings', {
        taskAutoAssign: val,
        expectedVersion: companySettings?.version,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company-settings'] });
    },
    onError: () => {
      setTaskAutoAssign(companySettings?.taskAutoAssign ?? false);
      toast({ title: 'Error', description: 'Could not save setting. Please try again.', variant: 'destructive' });
    },
  });

  const assignNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/ai/assign-chores');
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.assignments?.length ?? 0;
      const source = data.source === 'schedule' ? 'scheduled employees' : data.source === 'clocked-in' ? 'clocked-in employees' : 'employees';
      if (count === 0) {
        toast({ title: 'Nothing to assign', description: data.message || 'All tasks are already assigned or no employees are available.' });
        setLastAssignResult(null);
      } else {
        toast({ title: `${count} task${count !== 1 ? 's' : ''} assigned`, description: `Distributed to ${source}.` });
        setLastAssignResult({ count, source });
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not auto-assign tasks. Please try again.', variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (settings) {
      setShiftBlocks(settings.shiftBlocks?.length > 0 ? settings.shiftBlocks : [
        { name: "Morning", startTime: "09:00", endTime: "14:00" },
        { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
      ]);
      setStaffingTiers(settings.staffingTiers?.length > 0 ? settings.staffingTiers : [
        { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
        { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
        { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
      ]);
      setMinimumStaffing(settings.minimumStaffing ?? 2);
      setStoreHours(settings.storeHours?.length === 7 ? settings.storeHours : DEFAULT_STORE_HOURS);
      setShiftOverlapMinutes(settings.shift_overlap_minutes ?? settings.shiftOverlapMinutes ?? 60);
      const rawBudgetLimit = settings.overlapBudgetLimit ?? settings.overlap_budget_limit;
      setOverlapBudgetLimit(rawBudgetLimit ? parseFloat(rawBudgetLimit) : null);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('PUT', '/api/ai-scheduling/settings', { shiftBlocks, staffingTiers, minimumStaffing, storeHours, shiftOverlapMinutes, overlapBudgetLimit });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/settings'] });
      toast({ title: "Saved", description: "AI scheduling settings updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const updateStoreHour = (dayIndex: number, field: keyof StoreHourEntry, value: any) => {
    const updated = [...storeHours];
    updated[dayIndex] = { ...updated[dayIndex], [field]: value };
    setStoreHours(updated);
  };

  const handleCopyHours = () => {
    if (copyFromDay === null || copyTargets.length === 0) return;
    const source = storeHours[copyFromDay];
    const updated = [...storeHours];
    copyTargets.forEach(targetDay => {
      updated[targetDay] = { ...updated[targetDay], openTime: source.openTime, closeTime: source.closeTime, isClosed: source.isClosed };
    });
    setStoreHours(updated);
    setCopyFromDay(null);
    setCopyTargets([]);
    toast({ title: "Copied", description: `${DAY_NAMES[copyFromDay]} hours copied to ${copyTargets.map(d => DAY_ABBREV[d]).join(', ')}.` });
  };

  const addShiftBlock = () => {
    setShiftBlocks([...shiftBlocks, { name: "", startTime: "09:00", endTime: "17:00" }]);
  };

  const removeShiftBlock = (index: number) => {
    setShiftBlocks(shiftBlocks.filter((_, i) => i !== index));
  };

  const updateShiftBlock = (index: number, field: keyof ShiftBlock, value: string) => {
    const updated = [...shiftBlocks];
    updated[index] = { ...updated[index], [field]: value };
    setShiftBlocks(updated);
  };

  const addStaffingTier = () => {
    const lastTier = staffingTiers[staffingTiers.length - 1];
    const newMin = lastTier ? lastTier.maxRevenue + 1 : 0;
    setStaffingTiers([...staffingTiers, { minRevenue: newMin, maxRevenue: newMin + 5000, employeeCount: 2 }]);
  };

  const removeStaffingTier = (index: number) => {
    setStaffingTiers(staffingTiers.filter((_, i) => i !== index));
  };

  const updateStaffingTier = (index: number, field: keyof StaffingTier, value: number) => {
    const updated = [...staffingTiers];
    updated[index] = { ...updated[index], [field]: value };
    setStaffingTiers(updated);
  };

  interface RosterEmployee {
    id: string;
    name: string;
    email: string;
    employmentType: string;
    roleName: string;
    showInSchedule: boolean;
    targetWeeklyHours: number | null;
  }

  const { data: roster, isLoading: rosterLoading } = useQuery<RosterEmployee[]>({
    queryKey: ['/api/ai-scheduling/roster'],
  });

  const rosterMutation = useMutation({
    mutationFn: async ({ employeeId, data }: { employeeId: string; data: { showInSchedule?: boolean; targetWeeklyHours?: number | null } }) => {
      return apiRequest('PUT', `/api/ai-scheduling/roster/${employeeId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/roster'] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update employee.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="p-4">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="h-4 w-4" />
            Store Hours
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Set your store's operating hours for each day of the week. The AI will only schedule shifts within these hours.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {storeHours.map((entry, index) => (
            <div key={index} className={`flex items-center gap-3 p-3 rounded-lg ${entry.isClosed ? 'bg-muted/20 opacity-60' : 'bg-muted/50'}`}>
              <div className="w-24 font-medium text-sm">{DAY_NAMES[index]}</div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!entry.isClosed}
                  onCheckedChange={(open) => updateStoreHour(index, 'isClosed', !open)}
                />
                <span className="text-xs text-muted-foreground w-12">{entry.isClosed ? 'Closed' : 'Open'}</span>
              </div>
              {!entry.isClosed && (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={entry.openTime}
                      onChange={(e) => updateStoreHour(index, 'openTime', e.target.value)}
                      className="h-8 w-32"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={entry.closeTime}
                      onChange={(e) => updateStoreHour(index, 'closeTime', e.target.value)}
                      className="h-8 w-32"
                    />
                  </div>
                </>
              )}
            </div>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 mt-2">
                <Copy className="h-3 w-3" /> Copy Hours to Other Days
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-medium">Copy from</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {DAY_ABBREV.map((name, i) => (
                      <Button
                        key={i}
                        variant={copyFromDay === i ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => { setCopyFromDay(i); setCopyTargets([]); }}
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                </div>
                {copyFromDay !== null && (
                  <>
                    <Separator />
                    <div>
                      <Label className="text-xs font-medium">
                        Copy to ({storeHours[copyFromDay].isClosed ? 'Closed' : `${storeHours[copyFromDay].openTime} - ${storeHours[copyFromDay].closeTime}`})
                      </Label>
                      <div className="space-y-1.5 mt-1.5">
                        {DAY_NAMES.map((name, i) => {
                          if (i === copyFromDay) return null;
                          return (
                            <label key={i} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={copyTargets.includes(i)}
                                onCheckedChange={(checked) => {
                                  setCopyTargets(prev => checked ? [...prev, i] : prev.filter(d => d !== i));
                                }}
                              />
                              <span className="text-sm">{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={copyTargets.length === 0}
                      onClick={handleCopyHours}
                      className="w-full gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      Copy to {copyTargets.length} day{copyTargets.length !== 1 ? 's' : ''}
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            Sales Floor Roster
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Toggle employees between <strong>Sales Floor</strong> (included in AI shift suggestions) and <strong>Back Office</strong> (never scheduled on the floor). Set target weekly hours so the AI prioritizes getting full-time employees to their goal.
          </p>
        </CardHeader>
        <CardContent>
          {rosterLoading ? (
            <div className="text-sm text-muted-foreground">Loading employees...</div>
          ) : !roster || roster.length === 0 ? (
            <div className="text-sm text-muted-foreground">No active employees found.</div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 text-xs font-medium text-muted-foreground px-3 pb-1">
                <div>Employee</div>
                <div className="text-center w-24">Sales Floor</div>
                <div className="text-center w-28">Target Hrs/Wk</div>
                <div className="w-8"></div>
              </div>
              {roster.map((emp) => (
                <div key={emp.id} className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center p-3 rounded-lg ${emp.showInSchedule ? 'bg-muted/50' : 'bg-muted/20 opacity-60'}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{emp.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {emp.roleName}
                      </Badge>
                      {!emp.showInSchedule && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                          Back Office
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{emp.email} · {emp.employmentType || 'Not set'}</div>
                  </div>
                  <div className="flex justify-center w-24">
                    <Switch
                      checked={emp.showInSchedule}
                      onCheckedChange={(checked) => {
                        rosterMutation.mutate({ employeeId: emp.id, data: { showInSchedule: checked } });
                      }}
                    />
                  </div>
                  <div className="w-28">
                    {emp.showInSchedule ? (
                      <Input
                        type="number"
                        min={0}
                        max={80}
                        step={0.5}
                        placeholder="None"
                        defaultValue={emp.targetWeeklyHours ?? ''}
                        onBlur={(e) => {
                          const val = e.target.value === '' ? null : parseFloat(e.target.value);
                          if (val !== emp.targetWeeklyHours) {
                            rosterMutation.mutate({ employeeId: emp.id, data: { targetWeeklyHours: val } });
                          }
                        }}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <UserX className="h-3 w-3" /> Back Office
                      </span>
                    )}
                  </div>
                  <div className="w-8">
                    {emp.targetWeeklyHours && emp.showInSchedule && (
                      <Target className="h-4 w-4 text-blue-500" />
                    )}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-2 px-1">
                Employees with <strong>Sales Floor</strong> off are marked <strong>Back Office</strong> and never appear in AI shift suggestions.
                Target hours tell the AI to prioritize giving that employee enough shifts to reach their weekly goal.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Shift Blocks
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Define the time slots your store operates. The AI will assign employees to these blocks.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {shiftBlocks.map((block, index) => (
            <div key={index} className="flex items-end gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="flex-1">
                <Label className="text-xs">Block Name</Label>
                <Input
                  value={block.name}
                  onChange={(e) => updateShiftBlock(index, 'name', e.target.value)}
                  placeholder="e.g., Morning"
                />
              </div>
              <div className="w-32">
                <Label className="text-xs">Start</Label>
                <Input
                  type="time"
                  value={block.startTime}
                  onChange={(e) => updateShiftBlock(index, 'startTime', e.target.value)}
                />
              </div>
              <div className="w-32">
                <Label className="text-xs">End</Label>
                <Input
                  type="time"
                  value={block.endTime}
                  onChange={(e) => updateShiftBlock(index, 'endTime', e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeShiftBlock(index)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addShiftBlock} className="gap-1">
            <Plus className="h-3 w-3" /> Add Shift Block
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Staffing Tiers
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Set how many employees should be scheduled based on predicted daily sales revenue.
            The AI uses last year's sales data (matched by day of week) to predict revenue for each day.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-xs font-medium text-muted-foreground px-3">
            <div>Min Revenue</div>
            <div>Max Revenue</div>
            <div>Staff Needed</div>
            <div></div>
          </div>
          {staffingTiers.map((tier, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={tier.minRevenue}
                    onChange={(e) => updateStaffingTier(index, 'minRevenue', parseInt(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={tier.maxRevenue}
                    onChange={(e) => updateStaffingTier(index, 'maxRevenue', parseInt(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="w-20">
                <Input
                  type="number"
                  min={1}
                  value={tier.employeeCount}
                  onChange={(e) => updateStaffingTier(index, 'employeeCount', parseInt(e.target.value) || 1)}
                  className="h-8"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeStaffingTier(index)}
                className="text-destructive hover:text-destructive h-8 w-8"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addStaffingTier} className="gap-1">
            <Plus className="h-3 w-3" /> Add Tier
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Minimum Staffing
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The absolute minimum number of employees that must be scheduled at any time, regardless of sales predictions.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Label>Minimum employees per shift</Label>
            <Input
              type="number"
              min={1}
              value={minimumStaffing}
              onChange={(e) => setMinimumStaffing(parseInt(e.target.value) || 1)}
              className="w-20"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Shift Handoff & 3S
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            MAinager schedules overlap between shifts so your team has time for briefing and 3S (Sweep, Sort, Standardize). This is where handoffs happen and your team learns to see waste.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">Overlap duration</Label>
            <div className="flex gap-2">
              {[30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => setShiftOverlapMinutes(mins)}
                  className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    shiftOverlapMinutes === mins
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  {mins} min
                </button>
              ))}
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <Switch
              checked={overlapBudgetLimit !== null}
              onCheckedChange={(checked) => setOverlapBudgetLimit(checked ? 500 : null)}
            />
            <div className="flex-1">
              <Label className="text-sm font-medium">Budget warning</Label>
              <p className="text-xs text-muted-foreground">Alert me if overlap hours push labor costs above a weekly limit</p>
            </div>
          </div>
          {overlapBudgetLimit !== null && (
            <div className="flex items-center gap-2 pl-12">
              <span className="text-sm font-medium">$</span>
              <Input
                type="number"
                min={0}
                step={50}
                value={overlapBudgetLimit}
                onChange={(e) => setOverlapBudgetLimit(parseFloat(e.target.value) || 0)}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">per week</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Daily task auto-assignment ─────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Daily task auto-assignment
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically distribute today's unassigned tasks each morning.
              </p>
            </div>
            <Switch
              checked={taskAutoAssign}
              disabled={saveTaskAutoAssignMutation.isPending}
              onCheckedChange={(val) => {
                setTaskAutoAssign(val);
                saveTaskAutoAssignMutation.mutate(val);
              }}
              aria-label="Toggle daily task auto-assignment"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl bg-muted/50 p-3 space-y-2">
            <div className="flex items-start gap-2.5">
              <CalendarCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Scheduled workers first</p>
                <p className="text-xs text-muted-foreground">Tasks are distributed among team members who have a shift today.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Users className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Falls back to clocked-in</p>
                <p className="text-xs text-muted-foreground">If nobody is scheduled, tasks go to whoever is already clocked in.</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {taskAutoAssign
                ? 'Auto-assignment runs each morning and whenever a new unassigned task is created.'
                : 'Auto-assignment is off — you assign tasks manually.'}
            </p>
            <Badge variant={taskAutoAssign ? 'default' : 'outline'} className="text-xs shrink-0">
              {taskAutoAssign ? 'Auto' : 'Manual'}
            </Badge>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Assign today's tasks now</p>
              <p className="text-xs text-muted-foreground">Run assignment immediately without waiting for the morning cron.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => assignNowMutation.mutate()}
              disabled={assignNowMutation.isPending}
              className="shrink-0 gap-1.5"
            >
              {assignNowMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Wand2 className="h-3.5 w-3.5" />}
              {assignNowMutation.isPending ? 'Assigning…' : 'Assign Now'}
            </Button>
          </div>

          {lastAssignResult && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <Wand2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
              <span>
                <span className="font-semibold text-green-700 dark:text-green-400">{lastAssignResult.count} task{lastAssignResult.count !== 1 ? 's' : ''}</span> assigned to {lastAssignResult.source}.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "Saving..." : "Save AI Scheduling Settings"}
        </Button>
      </div>
    </div>
  );
}
