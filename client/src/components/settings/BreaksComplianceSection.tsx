import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function BreaksComplianceSection({ settingsForm, updateForm }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Break rule 1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enabled</Label>
            <Switch checked={settingsForm.breakRule1Enabled ?? true} onCheckedChange={val => updateForm('breakRule1Enabled', val)} />
          </div>
          {settingsForm.breakRule1Enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Minutes</Label>
                <Input type="number" value={settingsForm.breakRule1Minutes ?? 10} onChange={e => updateForm('breakRule1Minutes', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={settingsForm.breakRule1Type || 'paid'} onValueChange={val => updateForm('breakRule1Type', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Every (hours)</Label>
                <Input type="number" value={settingsForm.breakRule1EveryHours ?? 4} onChange={e => updateForm('breakRule1EveryHours', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Required</Label>
                <Select value={settingsForm.breakRule1Required || 'optional'} onValueChange={val => updateForm('breakRule1Required', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="optional">Optional</SelectItem>
                    <SelectItem value="mandatory">Mandatory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Break rule 2</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enabled</Label>
            <Switch checked={settingsForm.breakRule2Enabled ?? true} onCheckedChange={val => updateForm('breakRule2Enabled', val)} />
          </div>
          {settingsForm.breakRule2Enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Minutes</Label>
                <Input type="number" value={settingsForm.breakRule2Minutes ?? 30} onChange={e => updateForm('breakRule2Minutes', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={settingsForm.breakRule2Type || 'unpaid'} onValueChange={val => updateForm('breakRule2Type', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Every (hours)</Label>
                <Input type="number" value={settingsForm.breakRule2EveryHours ?? 6} onChange={e => updateForm('breakRule2EveryHours', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Required</Label>
                <Select value={settingsForm.breakRule2Required || 'optional'} onValueChange={val => updateForm('breakRule2Required', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="optional">Optional</SelectItem>
                    <SelectItem value="mandatory">Mandatory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unpaid breaks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.subtractUnpaidBreaks ?? true} onCheckedChange={val => updateForm('subtractUnpaidBreaks', !!val)} />
            <div>
              <Label className="text-sm">Subtract unpaid breaks from total hours</Label>
              <p className="text-xs text-muted-foreground">Automatically deduct unpaid break time from employee total hours</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.convertExcessToUnpaid || false} onCheckedChange={val => updateForm('convertExcessToUnpaid', !!val)} />
            <div>
              <Label className="text-sm">Convert excess break time to unpaid</Label>
              <p className="text-xs text-muted-foreground">If an employee takes a longer break than allowed, the excess is treated as unpaid</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.awardMissedBreakHours || false} onCheckedChange={val => updateForm('awardMissedBreakHours', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Award missed break hours</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Award</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.missedBreakAwardHours ?? 1} onChange={e => updateForm('missedBreakAwardHours', parseInt(e.target.value) || 0)} disabled={!settingsForm.awardMissedBreakHours} />
                <span className="text-xs text-muted-foreground">hour(s) for missed breaks</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Missed break resolution</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={settingsForm.missedBreakPolicy || 'managers_only'} onValueChange={val => updateForm('missedBreakPolicy', val)} className="space-y-3">
            <div className="flex items-center gap-3">
              <RadioGroupItem value="managers_only" id="managers-only" />
              <Label htmlFor="managers-only" className="text-sm">Managers only can resolve missed breaks</Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="team_members" id="team-members" />
              <Label htmlFor="team-members" className="text-sm">Team members can resolve their own missed breaks</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
