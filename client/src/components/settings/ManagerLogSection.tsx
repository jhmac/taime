import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActivityLog } from '@shared/schema';
import type { ManagerLogSectionProps } from '@/components/settings/types';

export default function ManagerLogSection({
  activityLogs,
  formatLogAction,
  formatLogTime,
}: ManagerLogSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity log</CardTitle>
        </CardHeader>
        <CardContent>
          {activityLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity logged yet.</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {activityLogs.map((log: ActivityLog) => (
                <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{formatLogAction(log)}</p>
                    <p className="text-xs text-muted-foreground">{log.details}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">{formatLogTime(log.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
