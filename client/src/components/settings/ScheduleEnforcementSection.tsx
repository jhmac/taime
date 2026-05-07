import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { DAYS_OF_WEEK, TIME_OPTIONS } from '@/components/settings/constants';
import type { SettingsSectionProps } from '@/components/settings/types';
import type { DaySchedulingHours, SchedulingHoursByDay } from '@shared/schema';

const ALL_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type DayKey = typeof ALL_DAYS[number];

export default function ScheduleEnforcementSection({ settingsForm, updateForm }: SettingsSectionProps) {
  const workWeekStart: DayKey = (settingsForm.workWeekStart as DayKey) || 'sunday';

  const startIdx = ALL_DAYS.indexOf(workWeekStart);
  const orderedDays: DayKey[] = [
    ...ALL_DAYS.slice(startIdx),
    ...ALL_DAYS.slice(0, startIdx),
  ];

  const hoursByDay = (settingsForm.schedulingHoursByDay ?? {}) as Partial<SchedulingHoursByDay>;

  const getDefaultDay = (): DaySchedulingHours => ({
    enabled: true,
    startTime: (settingsForm.schedulingStartTime as string) || '09:00',
    endTime: (settingsForm.schedulingEndTime as string) || '17:00',
  });

  const getDayData = (day: DayKey): DaySchedulingHours =>
    hoursByDay[day] ?? getDefaultDay();

  const updateDay = (day: DayKey, field: keyof DaySchedulingHours, value: string | boolean) => {
    const current = getDayData(day);
    updateForm('schedulingHoursByDay', {
      ...hoursByDay,
      [day]: { ...current, [field]: value },
    });
  };

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
        <CardContent>
          <div className="space-y-3">
            {orderedDays.map(day => {
              const dayData = getDayData(day);
              const label = DAYS_OF_WEEK.find(d => d.value === day)?.label ?? day;
              const closed = !dayData.enabled;
              return (
                <div key={day} className="flex items-center gap-3">
                  <Switch
                    checked={dayData.enabled}
                    onCheckedChange={val => updateDay(day, 'enabled', val)}
                  />
                  <span className={`w-24 text-sm font-medium ${closed ? 'text-muted-foreground' : ''}`}>
                    {label}
                  </span>
                  <Select
                    value={dayData.startTime}
                    onValueChange={val => updateDay(day, 'startTime', val)}
                    disabled={closed}
                  >
                    <SelectTrigger className={`w-32 ${closed ? 'opacity-40' : ''}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className={`text-sm text-muted-foreground ${closed ? 'opacity-40' : ''}`}>to</span>
                  <Select
                    value={dayData.endTime}
                    onValueChange={val => updateDay(day, 'endTime', val)}
                    disabled={closed}
                  >
                    <SelectTrigger className={`w-32 ${closed ? 'opacity-40' : ''}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
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
    </div>
  );
}
