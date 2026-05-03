import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DAYS_OF_WEEK } from '@/components/settings/constants';
import type { SettingsSectionProps } from '@/components/settings/types';

const DAY_VALUE_TO_NUMBER: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const NUMBER_TO_DAY_VALUE: Record<number, string> = Object.fromEntries(
  Object.entries(DAY_VALUE_TO_NUMBER).map(([k, v]) => [v, k])
);

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 || 12;
  return { value: String(h), label: `${display}:00 ${ampm}` };
});

export default function WeeklyDigestSection({ settingsForm, updateForm }: SettingsSectionProps) {
  const enabled = settingsForm.weeklyDigestEnabled ?? true;
  const dayNumber = settingsForm.weeklyDigestDayOfWeek ?? 0;
  const hourNumber = settingsForm.weeklyDigestHour ?? 17;
  const timezone = settingsForm.timezone || 'America/New_York';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly insights email</CardTitle>
          <CardDescription>
            Choose when each week's operations digest arrives in owner and manager inboxes.
            The schedule uses your store's timezone ({timezone}).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm">Send weekly digest email</Label>
              <p className="text-xs text-muted-foreground">
                When off, this store is skipped on the next scheduled run.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(val) => updateForm('weeklyDigestEnabled', !!val)}
              data-testid="switch-weekly-digest-enabled"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-sm">Day of week</Label>
              <Select
                value={NUMBER_TO_DAY_VALUE[dayNumber] || 'sunday'}
                onValueChange={(val) => updateForm('weeklyDigestDayOfWeek', DAY_VALUE_TO_NUMBER[val] ?? 0)}
                disabled={!enabled}
              >
                <SelectTrigger data-testid="select-weekly-digest-day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">Hour of day</Label>
              <Select
                value={String(hourNumber)}
                onValueChange={(val) => updateForm('weeklyDigestHour', parseInt(val, 10))}
                disabled={!enabled}
              >
                <SelectTrigger data-testid="select-weekly-digest-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Tip: pick a slot when owners are likely planning the week ahead, like Sunday evening or Monday morning.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
