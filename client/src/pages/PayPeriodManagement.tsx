import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Download, Calendar, CalendarClock, RefreshCw, ChevronRight, Settings2 } from "lucide-react";
import type { PayrollPeriod, PayPeriodSettings, WorkflowLog, Permission } from "@shared/schema";

export default function PayPeriodManagement() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const isAdmin = user?.role?.name === 'owner' || user?.role?.name === 'admin';
  const canManagePayroll = isAdmin || userPermissions?.some?.(p => p.name === 'admin.manage_payroll' || p.name === 'admin.manage_all') || false;

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [anchorDate, setAnchorDate] = useState("");
  const [intervalType, setIntervalType] = useState<'weekly' | 'bi-weekly' | 'monthly'>('bi-weekly');
  const [isAutomationEnabled, setIsAutomationEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [daysBeforeNotification, setDaysBeforeNotification] = useState(7);
  const [scheduleGenerationDays, setScheduleGenerationDays] = useState(5);

  const { data: payPeriods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ['/api/payroll/periods'],
  });

  const { data: settings } = useQuery<PayPeriodSettings>({
    queryKey: ['/api/payroll/settings'],
  });

  const { data: setupStatus } = useQuery<{ needsSetup: boolean; canManagePayroll: boolean }>({
    queryKey: ['/api/payroll/setup-status'],
  });

  const { data: workflowLogs = [] } = useQuery<WorkflowLog[]>({
    queryKey: ['/api/payroll/periods', selectedPeriodId, 'workflow-logs'],
    enabled: !!selectedPeriodId,
  });

  useEffect(() => {
    if (settings) {
      if (settings.firstPayPeriodStart) {
        setAnchorDate(new Date(settings.firstPayPeriodStart).toISOString().split('T')[0]);
      }
      setIntervalType((settings.intervalType as 'weekly' | 'bi-weekly' | 'monthly') || 'bi-weekly');
      setIsAutomationEnabled(settings.isAutomationEnabled || false);
      setDaysBeforeNotification(settings.daysBeforeNotification || 7);
      setScheduleGenerationDays(settings.scheduleGenerationDays || 5);
    }
  }, [settings]);

  function calculateEndDate(start: string, interval: string): string {
    const d = new Date(start + 'T00:00:00');
    switch (interval) {
      case 'weekly':
        d.setDate(d.getDate() + 6);
        break;
      case 'monthly':
        d.setMonth(d.getMonth() + 1);
        d.setDate(d.getDate() - 1);
        break;
      default:
        d.setDate(d.getDate() + 13);
        break;
    }
    return d.toISOString().split('T')[0];
  }

  const setupMutation = useMutation({
    mutationFn: async () => {
      if (!anchorDate) throw new Error("Please select a start date");
      const endDate = calculateEndDate(anchorDate, intervalType);
      return apiRequest('POST', '/api/payroll/setup', {
        intervalType,
        firstPayPeriodStart: anchorDate + 'T00:00:00',
        firstPayPeriodEnd: endDate + 'T23:59:59',
        isAutomationEnabled,
        isSetupComplete: true,
        daysBeforeNotification,
        scheduleGenerationDays,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/periods'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/setup-status'] });
      toast({ title: "Pay periods created", description: "Your pay periods have been set up and future periods will be generated automatically." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to set up pay periods.", variant: "destructive" });
    },
  });

  const createNextMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/payroll/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to create pay period');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/periods'] });
      toast({ title: "Created", description: "Next pay period created." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create pay period.", variant: "destructive" });
    },
  });

  const getWorkflowStateBadge = (state: string) => {
    const colorMap: Record<string, string> = {
      'created': 'bg-gray-500',
      'availability_requested': 'bg-blue-500',
      'availability_collected': 'bg-green-500',
      'schedule_generated': 'bg-purple-500',
      'schedule_sent_for_review': 'bg-orange-500',
      'schedule_confirmed': 'bg-teal-500',
      'conflicts_resolved': 'bg-indigo-500',
      'finalized': 'bg-green-600',
      'processed': 'bg-gray-600'
    };
    return (
      <Badge className={`${colorMap[state] || 'bg-gray-500'} text-white text-[10px]`}>
        {state.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
      </Badge>
    );
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  const intervalLabel = (type: string) => {
    switch (type) {
      case 'weekly': return '7 days';
      case 'bi-weekly': return '14 days';
      case 'monthly': return '1 month';
      default: return type;
    }
  };

  function getPreviewPeriods() {
    if (!anchorDate) return [];
    const periods = [];
    let start = new Date(anchorDate + 'T00:00:00');
    for (let i = 0; i < 4; i++) {
      const end = new Date(start);
      switch (intervalType) {
        case 'weekly': end.setDate(start.getDate() + 6); break;
        case 'monthly': end.setMonth(start.getMonth() + 1); end.setDate(start.getDate() - 1); break;
        default: end.setDate(start.getDate() + 13); break;
      }
      periods.push({
        start: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        end: end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      });
      const nextStart = new Date(end);
      nextStart.setDate(nextStart.getDate() + 1);
      start = nextStart;
    }
    return periods;
  }

  if (!canManagePayroll) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You need payroll management permissions to view this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const needsSetup = !settings?.isSetupComplete || setupStatus?.needsSetup;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="space-y-4 max-w-2xl mx-auto">

        {/* Setup / Configuration Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              {needsSetup ? 'Set Up Pay Periods' : 'Pay Period Configuration'}
            </CardTitle>
            <CardDescription>
              {needsSetup
                ? 'Choose when your first pay period starts and how often they repeat. The app will create your upcoming pay periods automatically from this date.'
                : `Pay periods repeat every ${intervalLabel(settings?.intervalType || 'bi-weekly')} starting from ${settings?.firstPayPeriodStart ? formatDate(settings.firstPayPeriodStart.toString()) : 'not set'}. New periods are added as needed.`
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Pay Period Start Date</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Pick the first day of your first pay period. All future periods will be calculated from this date.
              </p>
              <Input
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="w-full"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">Pay Period Length</Label>
              <Select value={intervalType} onValueChange={(v: any) => setIntervalType(v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly (7 days)</SelectItem>
                  <SelectItem value="bi-weekly">Bi-weekly (14 days)</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Auto-create future periods</Label>
                <p className="text-xs text-muted-foreground">Automatically generate upcoming pay periods</p>
              </div>
              <Switch checked={isAutomationEnabled} onCheckedChange={setIsAutomationEnabled} />
            </div>

            {anchorDate && (
              <>
                <Separator />
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Preview: First 4 pay periods</Label>
                  <div className="space-y-1">
                    {getPreviewPeriods().map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span>{p.start}</span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        <span>{p.end}</span>
                        {i === 0 && <Badge variant="outline" className="text-[10px] ml-auto">First period</Badge>}
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground mt-1">...and more will be added as each period completes</p>
                  </div>
                </div>
              </>
            )}

            <Button
              onClick={() => setShowAdvanced(!showAdvanced)}
              variant="ghost"
              size="sm"
              className="text-xs gap-1"
            >
              <Settings2 className="h-3 w-3" />
              {showAdvanced ? 'Hide' : 'Show'} advanced settings
            </Button>

            {showAdvanced && (
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div>
                  <Label className="text-xs">Days before period ends to request availability</Label>
                  <Input
                    type="number"
                    className="h-8 mt-1"
                    min={1}
                    max={14}
                    value={daysBeforeNotification}
                    onChange={(e) => setDaysBeforeNotification(parseInt(e.target.value) || 7)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Days before period starts to generate schedule</Label>
                  <Input
                    type="number"
                    className="h-8 mt-1"
                    min={1}
                    max={14}
                    value={scheduleGenerationDays}
                    onChange={(e) => setScheduleGenerationDays(parseInt(e.target.value) || 5)}
                  />
                </div>
              </div>
            )}

            <Button
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending || !anchorDate}
              className="w-full"
            >
              {setupMutation.isPending ? "Setting up..." : needsSetup ? "Set Up Pay Periods" : "Update Pay Period Settings"}
            </Button>
          </CardContent>
        </Card>

        {/* Pay Periods List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Pay Periods
              </CardTitle>
              <CardDescription>
                {payPeriods.length === 0 ? 'No pay periods yet. Set up your start date above.' : `${payPeriods.length} pay period${payPeriods.length > 1 ? 's' : ''}`}
              </CardDescription>
            </div>
            {payPeriods.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => createNextMutation.mutate()}
                disabled={createNextMutation.isPending}
              >
                <RefreshCw className={`h-3 w-3 ${createNextMutation.isPending ? 'animate-spin' : ''}`} />
                Add Next
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {payPeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Set up your pay period start date above to get started.</p>
            ) : (
              payPeriods.map((period) => {
                const now = new Date();
                const start = new Date(period.startDate);
                const end = new Date(period.endDate);
                const isCurrent = now >= start && now <= end;
                const isPast = now > end;
                const isFuture = now < start;

                return (
                  <div
                    key={period.id}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedPeriodId === period.id ? 'ring-2 ring-primary' : ''
                    } ${isCurrent ? 'bg-primary/5 border-primary/30' : isPast ? 'opacity-60' : 'hover:bg-muted/50'}`}
                    onClick={() => setSelectedPeriodId(period.id === selectedPeriodId ? '' : period.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium">
                          {formatDate(period.startDate.toString())} - {formatDate(period.endDate.toString())}
                        </div>
                        {isCurrent && <Badge className="bg-primary text-primary-foreground text-[10px]">Current</Badge>}
                        {isFuture && <Badge variant="outline" className="text-[10px]">Upcoming</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        {getWorkflowStateBadge(period.workflowState || 'created')}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            const sd = new Date(period.startDate).toISOString().split('T')[0];
                            const ed = new Date(period.endDate).toISOString().split('T')[0];
                            window.open(`/api/payroll/export?startDate=${sd}&endDate=${ed}`, '_blank');
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Workflow Logs for selected period */}
        {selectedPeriodId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Workflow Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {workflowLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center">No activity logged yet for this period.</p>
              ) : (
                workflowLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="p-2 bg-muted/30 rounded text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{log.workflowStep.replace(/_/g, ' ')}</span>
                      <Badge variant={log.status === 'success' ? 'default' : 'destructive'} className="text-[10px]">
                        {log.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1">{log.details}</p>
                    <p className="text-muted-foreground">
                      {log.createdAt ? new Date(log.createdAt).toLocaleString() : ''}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
