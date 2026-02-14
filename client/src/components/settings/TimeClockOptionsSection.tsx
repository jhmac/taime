import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function TimeClockOptionsSection({ settingsForm, updateForm }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.requestShiftExperience ?? true} onCheckedChange={val => updateForm('requestShiftExperience', !!val)} />
            <div>
              <Label className="text-sm">Request shift experience</Label>
              <p className="text-xs text-muted-foreground">Ask employees to rate their shift experience when clocking out</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.requireCashTipDeclaration || false} onCheckedChange={val => updateForm('requireCashTipDeclaration', !!val)} />
            <div>
              <Label className="text-sm">Require cash tip declaration</Label>
              <p className="text-xs text-muted-foreground">Employees must declare cash tips when clocking out</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.enableClockRounding || false} onCheckedChange={val => updateForm('enableClockRounding', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Enable clock rounding</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Round clock times to nearest</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.roundingIncrement ?? 5} onChange={e => updateForm('roundingIncrement', parseInt(e.target.value) || 5)} disabled={!settingsForm.enableClockRounding} />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mobile Time Clock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Enable mobile time clock</Label>
              <p className="text-xs text-muted-foreground">Allow employees to clock in/out from their mobile devices</p>
            </div>
            <Switch checked={settingsForm.enableMobileTimeClock ?? true} onCheckedChange={val => updateForm('enableMobileTimeClock', val)} />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowUnscheduledMobileClockIn || false} onCheckedChange={val => updateForm('allowUnscheduledMobileClockIn', !!val)} />
            <div>
              <Label className="text-sm">Allow unscheduled mobile clock-in</Label>
              <p className="text-xs text-muted-foreground">Employees can clock in even without a scheduled shift</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.geofenceEnforcement || false} onCheckedChange={val => updateForm('geofenceEnforcement', !!val)} />
            <div>
              <Label className="text-sm">Enable Geo-fence</Label>
              <p className="text-xs text-muted-foreground">Require employees to be within the geofence to clock in via mobile</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Web Time Clock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Enable web time clock</Label>
              <p className="text-xs text-muted-foreground">Allow clocking in/out from a web browser</p>
            </div>
            <Switch checked={settingsForm.enableWebTimeClock || false} onCheckedChange={val => updateForm('enableWebTimeClock', val)} />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowEmployeeWebClock || false} onCheckedChange={val => updateForm('allowEmployeeWebClock', !!val)} />
            <div>
              <Label className="text-sm">Allow employee web clock</Label>
              <p className="text-xs text-muted-foreground">Let employees use the web-based time clock from their own devices</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Smart Clock-In Prompt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Enable smart clock-in prompt</Label>
              <p className="text-xs text-muted-foreground">When an employee opens the app inside a geofenced work location, prompt them to clock in with one tap</p>
            </div>
            <Switch checked={settingsForm.enableSmartClockPrompt || false} onCheckedChange={val => updateForm('enableSmartClockPrompt', val)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clock Out on Focus Loss</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Auto clock-out when app loses focus</Label>
              <p className="text-xs text-muted-foreground">Automatically clock out employees when they switch away from the app, minimize the browser, or lock their phone</p>
            </div>
            <Switch checked={settingsForm.enableClockOutOnFocusLoss || false} onCheckedChange={val => updateForm('enableClockOutOnFocusLoss', val)} />
          </div>
          {settingsForm.enableClockOutOnFocusLoss && (
            <div>
              <Label className="text-xs">Grace period (seconds)</Label>
              <p className="text-xs text-muted-foreground mb-2">How long to wait before clocking out after focus is lost, to avoid accidental triggers</p>
              <Input type="number" min={5} max={300} value={settingsForm.focusLossGraceSeconds ?? 30} onChange={e => updateForm('focusLossGraceSeconds', parseInt(e.target.value) || 30)} className="w-32" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
