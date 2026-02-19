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
import { Plus, Trash2, Clock, DollarSign, Users, Save, UserCheck, UserX, Target } from 'lucide-react';

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

export default function AISchedulingSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ['/api/ai-scheduling/settings'],
  });

  const [shiftBlocks, setShiftBlocks] = useState<ShiftBlock[]>([]);
  const [staffingTiers, setStaffingTiers] = useState<StaffingTier[]>([]);
  const [minimumStaffing, setMinimumStaffing] = useState(2);

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
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('PUT', '/api/ai-scheduling/settings', { shiftBlocks, staffingTiers, minimumStaffing });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/settings'] });
      toast({ title: "Saved", description: "AI scheduling settings updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

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
            <UserCheck className="h-4 w-4" />
            Employee Scheduling Roster
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose which employees appear on the AI-generated schedule. Owners, admins, or other non-floor staff
            can be excluded. Set target weekly hours for full-time employees so the AI prioritizes giving them enough shifts.
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
                <div className="text-center w-24">On Schedule</div>
                <div className="text-center w-28">Target Hrs/Wk</div>
                <div className="w-8"></div>
              </div>
              {roster.map((emp) => (
                <div key={emp.id} className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center p-3 rounded-lg ${emp.showInSchedule ? 'bg-muted/50' : 'bg-muted/20 opacity-70'}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{emp.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {emp.roleName}
                      </Badge>
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
                        <UserX className="h-3 w-3" /> Excluded
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
                Employees with "On Schedule" turned off will never appear in AI-generated schedules.
                Target hours tell the AI to prioritize giving that employee enough shifts to reach their goal each week.
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
