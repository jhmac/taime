import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function PayrollSection({ settingsForm, updateForm }: SettingsSectionProps) {
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
    </div>
  );
}
