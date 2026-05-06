import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function DashboardSection({ settingsForm, updateForm }: SettingsSectionProps) {
  const topN = settingsForm.dashboardTopBottomN ?? 3;
  const lateThreshold = settingsForm.lateClockInAlertThreshold ?? 2;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business Health Monitor</CardTitle>
          <CardDescription>
            Configure how the Admin/Owner dashboard displays performance data and alerts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="topBottomN" className="text-sm">Top / Bottom N employees</Label>
            <p className="text-xs text-muted-foreground">
              How many employees to show in the top and bottom performance leaderboard panels.
            </p>
            <Input
              id="topBottomN"
              type="number"
              min={1}
              max={10}
              value={topN}
              onChange={(e) => updateForm('dashboardTopBottomN', Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 3)))}
              className="w-24"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lateThreshold" className="text-sm">Late arrivals to trigger HR flag (count)</Label>
            <p className="text-xs text-muted-foreground">
              Number of late clock-ins an employee must accumulate in the current pay period before
              appearing as a priority item in the HR Actions panel.
            </p>
            <Input
              id="lateThreshold"
              type="number"
              min={1}
              max={20}
              value={lateThreshold}
              onChange={(e) => updateForm('lateClockInAlertThreshold', Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 2)))}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
