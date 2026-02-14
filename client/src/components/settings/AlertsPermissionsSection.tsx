import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function AlertsPermissionsSection({ settingsForm, updateForm }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employee</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.textScheduleToEmployees || false} onCheckedChange={val => updateForm('textScheduleToEmployees', !!val)} />
            <div>
              <Label className="text-sm">Text schedule to employees</Label>
              <p className="text-xs text-muted-foreground">Automatically send schedule updates via text message to employees</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.employeesViewOwnScheduleOnly || false} onCheckedChange={val => updateForm('employeesViewOwnScheduleOnly', !!val)} />
            <div>
              <Label className="text-sm">Employees view own schedule only</Label>
              <p className="text-xs text-muted-foreground">Restrict employees to only see their own scheduled shifts</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manager</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.notifyManagerLateClockIn ?? true} onCheckedChange={val => updateForm('notifyManagerLateClockIn', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Notify manager of late clock-in</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Alert managers when employee is late by</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.managerLateAlertMinutes ?? 19} onChange={e => updateForm('managerLateAlertMinutes', parseInt(e.target.value) || 0)} disabled={!settingsForm.notifyManagerLateClockIn} />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.requireManagerApprovalAvailability ?? true} onCheckedChange={val => updateForm('requireManagerApprovalAvailability', !!val)} />
            <div>
              <Label className="text-sm">Require manager approval for availability</Label>
              <p className="text-xs text-muted-foreground">Managers must approve availability change requests from employees</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.managersScheduleOwnDept || false} onCheckedChange={val => updateForm('managersScheduleOwnDept', !!val)} />
            <div>
              <Label className="text-sm">Managers schedule own department only</Label>
              <p className="text-xs text-muted-foreground">Restrict managers to scheduling only employees in their department</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
