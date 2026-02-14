import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { SettingsSectionProps } from '@/components/settings/types';

export default function MessagesSection({ settingsForm, updateForm }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team communication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowShoutOuts ?? true} onCheckedChange={val => updateForm('allowShoutOuts', !!val)} />
            <div>
              <Label className="text-sm">Allow shout-outs</Label>
              <p className="text-xs text-muted-foreground">Enable team members to send recognition and shout-outs to each other</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowTeamMessaging ?? true} onCheckedChange={val => updateForm('allowTeamMessaging', !!val)} />
            <div>
              <Label className="text-sm">Allow team messaging</Label>
              <p className="text-xs text-muted-foreground">Enable direct and group messaging between team members</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
