import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { DAYS_OF_WEEK, TIME_OPTIONS } from '@/components/settings/constants';
import type { SettingsSectionProps } from '@/components/settings/types';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Wand2, Users, CalendarCheck, Loader2 } from 'lucide-react';

export default function ScheduleEnforcementSection({ settingsForm, updateForm }: SettingsSectionProps) {
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<{ count: number; source: string } | null>(null);

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
        setLastResult(null);
      } else {
        toast({ title: `${count} task${count !== 1 ? 's' : ''} assigned`, description: `Distributed to ${source}.` });
        setLastResult({ count, source });
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not auto-assign tasks. Please try again.', variant: 'destructive' });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work week</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Work week starts on</Label>
            <Select value={settingsForm.workWeekStart || 'sunday'} onValueChange={val => updateForm('workWeekStart', val)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map(d => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduling hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start time</Label>
              <Select value={settingsForm.schedulingStartTime || '09:00'} onValueChange={val => updateForm('schedulingStartTime', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>End time</Label>
              <Select value={settingsForm.schedulingEndTime || '17:00'} onValueChange={val => updateForm('schedulingEndTime', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clock-in rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-sm">Mark employee as late</span>
            <Input type="number" className="w-20" value={settingsForm.lateThresholdMinutes ?? 5} onChange={e => updateForm('lateThresholdMinutes', parseInt(e.target.value) || 0)} />
            <span className="text-sm">min after shift scheduled to start</span>
          </div>

          <Separator />

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.preventEarlyClockIn || false} onCheckedChange={val => updateForm('preventEarlyClockIn', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Prevent early clock-in</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Employees cannot clock in more than</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.earlyClockInMinutes ?? 5} onChange={e => updateForm('earlyClockInMinutes', parseInt(e.target.value) || 0)} disabled={!settingsForm.preventEarlyClockIn} />
                <span className="text-xs text-muted-foreground">minutes before their shift</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.preventEarlyBreakReturn || false} onCheckedChange={val => updateForm('preventEarlyBreakReturn', !!val)} />
            <div>
              <Label className="text-sm">Prevent early break return</Label>
              <p className="text-xs text-muted-foreground">Employees cannot end their break early</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.singleClockOutReminder ?? true} onCheckedChange={val => updateForm('singleClockOutReminder', !!val)} />
            <div>
              <Label className="text-sm">Clock-out reminder</Label>
              <p className="text-xs text-muted-foreground">Send a single reminder when an employee forgets to clock out</p>
            </div>
          </div>

          <Separator />

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.autoClockOutEnabled || false} onCheckedChange={val => updateForm('autoClockOutEnabled', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Auto clock-out</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Automatically clock out after</span>
                <Input type="number" className="w-20 h-7 text-xs" value={settingsForm.autoClockOutAfterMinutes ?? 480} onChange={e => updateForm('autoClockOutAfterMinutes', parseInt(e.target.value) || 0)} disabled={!settingsForm.autoClockOutEnabled} />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Daily task auto-assignment ─────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Daily task auto-assignment</CardTitle>
              <CardDescription className="mt-1 text-xs">
                Automatically distribute today's unassigned tasks each morning.
              </CardDescription>
            </div>
            <Switch
              checked={settingsForm.taskAutoAssign ?? false}
              onCheckedChange={val => updateForm('taskAutoAssign', val)}
              aria-label="Toggle daily task auto-assignment"
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* How it works */}
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

          {/* Mode label */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {settingsForm.taskAutoAssign
                ? 'Auto-assignment runs each morning and whenever a new unassigned task is created.'
                : 'Auto-assignment is off — you assign tasks manually.'}
            </p>
            <Badge variant={settingsForm.taskAutoAssign ? 'default' : 'outline'} className="text-xs shrink-0">
              {settingsForm.taskAutoAssign ? 'Auto' : 'Manual'}
            </Badge>
          </div>

          <Separator />

          {/* Assign Now */}
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

          {/* Last result */}
          {lastResult && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <Wand2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
              <span>
                <span className="font-semibold text-green-700 dark:text-green-400">{lastResult.count} task{lastResult.count !== 1 ? 's' : ''}</span> assigned to {lastResult.source}.
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
