import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

const CATEGORY_LABELS: Record<string, string> = {
  attendance: 'Attendance',
  breaks: 'Breaks',
  tasks: 'Tasks',
  chores: 'Chores',
  availability: 'Availability',
};

export default function PerformanceScoringSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedSettings, setEditedSettings] = useState<Record<string, any>>({});

  const { data: settings = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/performance/settings'],
  });

  const saveMutation = useMutation({
    mutationFn: async (updatedSettings: any[]) => {
      return await apiRequest('PUT', '/api/performance/settings', {
        settings: updatedSettings,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/performance/settings'] });
      setEditedSettings({});
      toast({ title: "Saved", description: "Performance scoring settings updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const handlePointChange = (eventType: string, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setEditedSettings(prev => ({
        ...prev,
        [eventType]: { ...(prev[eventType] || {}), pointValue: num },
      }));
    }
  };

  const handleToggle = (eventType: string, isActive: boolean) => {
    setEditedSettings(prev => ({
      ...prev,
      [eventType]: { ...(prev[eventType] || {}), isActive },
    }));
  };

  const handleSave = () => {
    const merged = settings.map((s: any) => ({
      ...s,
      ...(editedSettings[s.eventType] || {}),
    }));
    saveMutation.mutate(merged);
  };

  const hasChanges = Object.keys(editedSettings).length > 0;

  const groupedSettings = settings.reduce((acc: Record<string, any[]>, s: any) => {
    const cat = s.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <i className="fas fa-spinner fa-spin mr-2" />Loading performance settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center">
            <i className="fas fa-trophy text-primary mr-2" />
            Performance Point Values
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Configure how many points each action is worth. Positive points reward good behavior, negative points penalize infractions.
          </p>

          {Object.entries(groupedSettings).map(([category, items]: [string, any[]]) => (
            <div key={category} className="mb-6">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {CATEGORY_LABELS[category] || category}
              </h4>
              <div className="space-y-2">
                {items.map((setting: any) => {
                  const edited = editedSettings[setting.eventType] || {};
                  const currentPoints = edited.pointValue ?? setting.pointValue;
                  const currentActive = edited.isActive ?? setting.isActive;

                  return (
                    <div key={setting.eventType} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3 flex-1">
                        <Switch
                          checked={currentActive}
                          onCheckedChange={(checked) => handleToggle(setting.eventType, checked)}
                        />
                        <div className={!currentActive ? 'opacity-50' : ''}>
                          <p className="text-sm font-medium">{setting.displayName}</p>
                          <p className="text-xs text-muted-foreground">{setting.eventType}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={currentPoints}
                          onChange={(e) => handlePointChange(setting.eventType, e.target.value)}
                          className="w-20 text-center"
                          disabled={!currentActive}
                        />
                        <Badge variant={currentPoints > 0 ? 'default' : currentPoints < 0 ? 'destructive' : 'outline'}>
                          {currentPoints > 0 ? '+' : ''}{currentPoints}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {hasChanges && (
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setEditedSettings({})}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
