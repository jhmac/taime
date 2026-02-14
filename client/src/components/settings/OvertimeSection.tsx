import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Trash2 } from 'lucide-react';
import { DAYS_OF_WEEK, TIME_OPTIONS } from '@/components/settings/constants';
import type { HolidayPayRule } from '@shared/schema';
import type { OvertimeSectionProps } from '@/components/settings/types';

export default function OvertimeSection({
  settingsForm,
  updateForm,
  holidayPayRules,
  holidayInstruction,
  setHolidayInstruction,
  parseHolidayPayMutation,
  deleteHolidayRuleMutation,
  holidayAiSummary,
}: OvertimeSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily overtime</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable daily overtime</Label>
            <Switch checked={settingsForm.enableDailyOvertime || false} onCheckedChange={val => updateForm('enableDailyOvertime', val)} />
          </div>
          {settingsForm.enableDailyOvertime && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Hours threshold</Label>
                <Input type="number" value={settingsForm.dailyOvertimeHours ?? 8} onChange={e => updateForm('dailyOvertimeHours', parseInt(e.target.value) || 8)} />
              </div>
              <div>
                <Label className="text-xs">Multiplier</Label>
                <Input type="number" step="0.25" value={settingsForm.dailyOvertimeMultiplier || '1.50'} onChange={e => updateForm('dailyOvertimeMultiplier', e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly overtime</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable weekly overtime</Label>
            <Switch checked={settingsForm.enableWeeklyOvertime ?? true} onCheckedChange={val => updateForm('enableWeeklyOvertime', val)} />
          </div>
          {settingsForm.enableWeeklyOvertime && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Hours threshold (per week)</Label>
                <Input type="number" value={settingsForm.overtimeThresholdHours ?? 40} onChange={e => updateForm('overtimeThresholdHours', parseInt(e.target.value) || 40)} />
              </div>
              <div>
                <Label className="text-xs">Multiplier</Label>
                <Input type="number" step="0.25" value={settingsForm.overtimeMultiplier || '1.50'} onChange={e => updateForm('overtimeMultiplier', e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overtime alert</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable overtime alert</Label>
            <Switch checked={settingsForm.overtimeAlertEnabled || false} onCheckedChange={val => updateForm('overtimeAlertEnabled', val)} />
          </div>
          {settingsForm.overtimeAlertEnabled && (
            <div>
              <Label className="text-xs">Alert when employee reaches (hours)</Label>
              <Input type="number" className="w-32" value={settingsForm.overtimeAlertHours ?? 40} onChange={e => updateForm('overtimeAlertHours', parseInt(e.target.value) || 40)} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workweek settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Work week starts on</Label>
              <Select value={settingsForm.workWeekStart || 'sunday'} onValueChange={val => updateForm('workWeekStart', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Start of workday</Label>
              <Select value={settingsForm.startOfWorkday || '00:00'} onValueChange={val => updateForm('startOfWorkday', val)}>
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
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.trackOvertimeAcrossLocations || false} onCheckedChange={val => updateForm('trackOvertimeAcrossLocations', !!val)} />
            <div>
              <Label className="text-sm">Track overtime across locations</Label>
              <p className="text-xs text-muted-foreground">Calculate overtime based on total hours across all locations</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holiday pay rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable holiday pay rate</Label>
            <Switch checked={settingsForm.enableHolidayPayRate || false} onCheckedChange={val => updateForm('enableHolidayPayRate', val)} />
          </div>
          {settingsForm.enableHolidayPayRate && (
            <>
              <div>
                <Label className="text-xs">Holiday pay multiplier</Label>
                <Input type="number" step="0.25" className="w-32" value={settingsForm.holidayPayMultiplier || '1.50'} onChange={e => updateForm('holidayPayMultiplier', e.target.value)} />
              </div>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Holiday Pay Rules</Label>
                <div className="space-y-2">
                  <Textarea placeholder="Describe your holiday pay rules in plain English, e.g., 'Christmas Day at 2x pay, Thanksgiving at 1.5x pay'" value={holidayInstruction} onChange={e => setHolidayInstruction(e.target.value)} rows={3} />
                  <Button size="sm" onClick={() => parseHolidayPayMutation.mutate(holidayInstruction)} disabled={!holidayInstruction || parseHolidayPayMutation.isPending}>
                    {parseHolidayPayMutation.isPending ? 'Processing...' : 'Save Holiday Rules'}
                  </Button>
                </div>
                {holidayAiSummary && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/10 rounded-lg text-sm text-green-700 dark:text-green-400">
                    {holidayAiSummary}
                  </div>
                )}
                {holidayPayRules.length > 0 && (
                  <div className="space-y-2">
                    {holidayPayRules.map((rule: HolidayPayRule) => (
                      <div key={rule.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">{rule.name}</p>
                          <p className="text-xs text-muted-foreground">{rule.month}/{rule.day} &middot; {rule.payMultiplier}x pay</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => deleteHolidayRuleMutation.mutate(rule.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
