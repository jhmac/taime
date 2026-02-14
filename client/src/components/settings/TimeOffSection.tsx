import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function TimeOffSection({ settingsForm, updateForm }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time off requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.limitTimeOffRequests || false} onCheckedChange={val => updateForm('limitTimeOffRequests', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Limit time off requests per day</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Maximum</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.timeOffMaxPerDay ?? 1} onChange={e => updateForm('timeOffMaxPerDay', parseInt(e.target.value) || 1)} disabled={!settingsForm.limitTimeOffRequests} />
                <span className="text-xs text-muted-foreground">employees off per day</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.limitTimeOffAdvance || false} onCheckedChange={val => updateForm('limitTimeOffAdvance', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Require advance notice for time off</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Must request at least</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.timeOffAdvanceDays ?? 0} onChange={e => updateForm('timeOffAdvanceDays', parseInt(e.target.value) || 0)} disabled={!settingsForm.limitTimeOffAdvance} />
                <span className="text-xs text-muted-foreground">days in advance</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
