import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function PayrollSection({ settingsForm, updateForm }: SettingsSectionProps) {
  const mileageRateCents = settingsForm.defaultMileageRateCents ?? 0;
  const mileageDisplay = mileageRateCents > 0 ? `= $${(mileageRateCents / 100).toFixed(2)}/mile` : 'No default reimbursement';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pay schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Pay frequency</Label>
            <Select value={settingsForm.payScheduleFrequency || 'every_two_weeks'} onValueChange={val => updateForm('payScheduleFrequency', val)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="every_two_weeks">Every two weeks</SelectItem>
                <SelectItem value="semi_monthly">Semi-monthly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Next payroll date</Label>
            <Input type="date" className="w-64" value={settingsForm.nextPayrollDate || ''} onChange={e => updateForm('nextPayrollDate', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Running payroll</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.lockTimesheetsAfterApproval || false} onCheckedChange={val => updateForm('lockTimesheetsAfterApproval', !!val)} />
            <div>
              <Label className="text-sm">Lock timesheets after approval</Label>
              <p className="text-xs text-muted-foreground">Prevent changes to timesheets once they have been approved for payroll</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mileage reimbursement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Default mileage rate (¢/mile)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Company-wide default rate applied to off-site trips when no rule-specific rate is set. Set to 0 to disable. Example: 25 = $0.25/mile.
            </p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={0}
                max={1000}
                className="w-24"
                value={mileageRateCents}
                onChange={e => updateForm('defaultMileageRateCents', parseInt(e.target.value) || 0)}
              />
              <span className="text-sm text-muted-foreground">{mileageDisplay}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
