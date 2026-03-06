import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidatePrefix, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Zap,
  ArrowRightLeft,
  X,
} from "lucide-react";

interface OTRiskEmployee {
  userId: string;
  firstName: string;
  lastName: string;
  currentHours: number;
  projectedHours: number;
  remainingShifts: Array<{
    scheduleId: string;
    startTime: string;
    endTime: string;
    shiftHours: number;
  }>;
  riskLevel: "green" | "yellow" | "red";
}

interface OTAlert {
  id: string;
  employeeId: string;
  currentHours: string;
  projectedHours: string;
  threshold: string;
  atRiskShiftId: string;
  suggestedReplacementId: string;
  aiReasoning: string;
  status: string;
  atRiskEmployeeName: string;
  replacementEmployeeName: string | null;
  shiftStart?: string;
  shiftEnd?: string;
  shiftHours?: number;
}

interface OTAlertsData {
  atRiskEmployees: OTRiskEmployee[];
  alerts: OTAlert[];
  weekStart: string;
  weekEnd: string;
  threshold: number;
}

function OTProgressBar({ hours, threshold }: { hours: number; threshold: number }) {
  const pct = Math.min((hours / threshold) * 100, 100);
  let colorClass = "bg-green-500";
  if (hours >= threshold - 2) colorClass = "bg-red-500";
  else if (hours >= threshold - 5) colorClass = "bg-amber-500";

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {hours.toFixed(1)}/{threshold}
      </span>
    </div>
  );
}

export default function OvertimePreventionPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: otData, isLoading } = useQuery<OTAlertsData>({
    queryKey: ["/api/timesheets/overtime-alerts"],
  });

  const applyMutation = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("POST", `/api/timesheets/overtime-alerts/${alertId}/apply`);
    },
    onSuccess: () => {
      toast({ title: "Swap approved", description: "The shift has been reassigned successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/overtime-alerts"] });
      invalidatePrefix("/api/timesheets/review");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("POST", `/api/timesheets/overtime-alerts/${alertId}/dismiss`);
    },
    onSuccess: () => {
      toast({ title: "Alert dismissed" });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/overtime-alerts"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleApproveAll = () => {
    if (!otData?.alerts) return;
    const pendingAlerts = otData.alerts.filter((a) => a.status === "pending");
    pendingAlerts.forEach((alert) => applyMutation.mutate(alert.id));
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!otData || (otData.atRiskEmployees.length === 0 && otData.alerts.length === 0)) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <CheckCircle2 className="h-10 w-10 mx-auto text-green-500 mb-2" />
          <p className="text-sm text-muted-foreground">No overtime risks detected this week.</p>
        </CardContent>
      </Card>
    );
  }

  const pendingAlerts = otData.alerts.filter((a) => a.status === "pending");

  return (
    <Card className="border-red-200 dark:border-red-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            Overtime Prevention Panel
          </CardTitle>
          {pendingAlerts.length > 1 && (
            <Button
              size="sm"
              variant="default"
              onClick={handleApproveAll}
              disabled={applyMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Approve All Safe Swaps ({pendingAlerts.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {otData.atRiskEmployees.map((emp) => (
          <div key={emp.userId} className="p-3 rounded-lg bg-muted/50 border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${emp.riskLevel === "red" ? "bg-red-500" : "bg-amber-500"}`} />
                <span className="font-medium text-sm">
                  {emp.firstName} {emp.lastName}
                </span>
                <Badge variant={emp.riskLevel === "red" ? "destructive" : "secondary"} className={emp.riskLevel === "yellow" ? "bg-amber-500 text-white" : ""}>
                  {emp.riskLevel === "red" ? "High Risk" : "Warning"}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {emp.remainingShifts.length} shift{emp.remainingShifts.length !== 1 ? "s" : ""} remaining
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm mb-2">
              <div>
                <span className="text-muted-foreground">Current:</span>{" "}
                <span className="font-mono font-medium">{emp.currentHours} hrs</span>
              </div>
              <div>
                <span className="text-muted-foreground">Projected:</span>{" "}
                <span className={`font-mono font-medium ${emp.projectedHours >= otData.threshold ? "text-red-600" : ""}`}>
                  {emp.projectedHours} hrs
                </span>
              </div>
            </div>
            <OTProgressBar hours={emp.currentHours} threshold={otData.threshold} />
          </div>
        ))}

        {pendingAlerts.length > 0 && (
          <div className="pt-2">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              AI Swap Suggestions
            </h4>
            <div className="space-y-3">
              {pendingAlerts.map((alert) => (
                <div key={alert.id} className="p-3 rounded-lg border bg-background">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <ArrowRightLeft className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <span className="text-sm font-medium">
                          Swap {alert.atRiskEmployeeName}'s shift → {alert.replacementEmployeeName || "Available employee"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {alert.aiReasoning}
                      </p>
                      {alert.shiftStart && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Shift: {new Date(alert.shiftStart).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}{" "}
                          {new Date(alert.shiftStart).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })} –{" "}
                          {alert.shiftEnd && new Date(alert.shiftEnd).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                          {alert.shiftHours && <span className="ml-1">({alert.shiftHours} hrs)</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => applyMutation.mutate(alert.id)}
                        disabled={applyMutation.isPending}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismissMutation.mutate(alert.id)}
                        disabled={dismissMutation.isPending}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
