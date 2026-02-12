import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Download } from "lucide-react";
import type { PayrollPeriod, PayPeriodSettings, WorkflowLog, Permission } from "@shared/schema";

export default function PayPeriodManagement() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch user permissions
  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const isAdmin = user?.role?.name === 'owner' || user?.role?.name === 'admin';
  const canManagePayroll = isAdmin || userPermissions?.some?.(p => p.name === 'hr.payroll_process' || p.name === 'hr.payroll_view' || p.name === 'admin.manage_all') || false;
  
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [automationSettings, setAutomationSettings] = useState({
    intervalType: 'bi-weekly' as 'weekly' | 'bi-weekly' | 'monthly',
    isAutomationEnabled: true,
    daysBeforeNotification: 7,
    scheduleGenerationDays: 5,
    automaticConflictResolution: true
  });

  // Fetch pay periods
  const { data: payPeriods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ['/api/payroll/periods'],
  });

  // Fetch automation settings
  const { data: settings } = useQuery<PayPeriodSettings>({
    queryKey: ['/api/payroll/settings'],
  });

  // Fetch workflow logs for selected period
  const { data: workflowLogs = [] } = useQuery<WorkflowLog[]>({
    queryKey: ['/api/payroll/periods', selectedPeriodId, 'workflow-logs'],
    enabled: !!selectedPeriodId,
  });

  // Initialize automation settings mutation
  const initializeAutomationMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/payroll/automation/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to initialize automation');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/settings'] });
      toast({
        title: "Success",
        description: "Automation settings initialized successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to initialize automation. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (settingsData: any) => {
      const response = await fetch('/api/payroll/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsData),
      });
      if (!response.ok) throw new Error('Failed to update settings');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/settings'] });
      toast({
        title: "Success",
        description: "Automation settings updated successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Create pay period mutation
  const createPeriodMutation = useMutation({
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
      toast({
        title: "Success",
        description: "New pay period created successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create pay period. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Trigger automation mutation
  const triggerAutomationMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/payroll/automation/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to trigger automation');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/periods'] });
      toast({
        title: "Success",
        description: "Automation workflow triggered successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to trigger automation. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update local settings when fetched
  useEffect(() => {
    if (settings) {
      setAutomationSettings({
        intervalType: settings.intervalType as 'weekly' | 'bi-weekly' | 'monthly',
        isAutomationEnabled: settings.isAutomationEnabled || false,
        daysBeforeNotification: settings.daysBeforeNotification || 7,
        scheduleGenerationDays: settings.scheduleGenerationDays || 5,
        automaticConflictResolution: settings.automaticConflictResolution || false
      });
    }
  }, [settings]);

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate(automationSettings);
  };

  const getWorkflowStateBadge = (state: string) => {
    const colorMap = {
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
      <Badge className={`${colorMap[state as keyof typeof colorMap] || 'bg-gray-500'} text-white`}>
        {state.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
      </Badge>
    );
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (!canManagePayroll) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="space-y-4">
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="space-y-4">
        {/* Automation Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Automation Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!settings ? (
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-3">Initialize automation to get started</p>
                <Button 
                  onClick={() => initializeAutomationMutation.mutate()}
                  disabled={initializeAutomationMutation.isPending}
                  size="sm"
                  className="w-full"
                >
                  {initializeAutomationMutation.isPending ? "Initializing..." : "Initialize Automation"}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <Label htmlFor="automation-enabled" className="text-sm">Enable Automation</Label>
                  <Switch
                    id="automation-enabled"
                    checked={automationSettings.isAutomationEnabled}
                    onCheckedChange={(checked) => 
                      setAutomationSettings(prev => ({ ...prev, isAutomationEnabled: checked }))
                    }
                  />
                </div>

                <div>
                  <Label className="text-xs">Pay Period Interval</Label>
                  <Select 
                    value={automationSettings.intervalType} 
                    onValueChange={(value: 'weekly' | 'bi-weekly' | 'monthly') => 
                      setAutomationSettings(prev => ({ ...prev, intervalType: value }))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="bi-weekly">Bi-weekly (Default)</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Days Before Notice</Label>
                  <Input
                    type="number"
                    className="h-8"
                    value={automationSettings.daysBeforeNotification}
                    onChange={(e) => 
                      setAutomationSettings(prev => ({ ...prev, daysBeforeNotification: parseInt(e.target.value) }))
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">Days before period ends to request availability</p>
                </div>

                <div>
                  <Label className="text-xs">Schedule Generation Days</Label>
                  <Input
                    type="number"
                    className="h-8"
                    value={automationSettings.scheduleGenerationDays}
                    onChange={(e) => 
                      setAutomationSettings(prev => ({ ...prev, scheduleGenerationDays: parseInt(e.target.value) }))
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">Days before period starts to generate schedule</p>
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-resolve" className="text-sm">Auto-resolve Conflicts</Label>
                  <Switch
                    id="auto-resolve"
                    checked={automationSettings.automaticConflictResolution}
                    onCheckedChange={(checked) => 
                      setAutomationSettings(prev => ({ ...prev, automaticConflictResolution: checked }))
                    }
                  />
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={handleSaveSettings}
                    disabled={updateSettingsMutation.isPending}
                    size="sm"
                    className="flex-1"
                  >
                    {updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
                  </Button>
                  <Button 
                    onClick={() => triggerAutomationMutation.mutate()}
                    disabled={triggerAutomationMutation.isPending}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    {triggerAutomationMutation.isPending ? "Triggering..." : "Trigger Now"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button 
              onClick={() => createPeriodMutation.mutate()}
              disabled={createPeriodMutation.isPending}
              variant="outline"
              size="sm"
              className="w-full"
              data-testid="create-pay-period-button"
            >
              {createPeriodMutation.isPending ? "Creating..." : "Create New Pay Period"}
            </Button>
            <Button 
              onClick={() => createPeriodMutation.mutate()}
              disabled={createPeriodMutation.isPending}
              size="sm"
              className="w-full"
              data-testid="create-payroll-schedule-button"
            >
              <i className="fas fa-calendar-plus mr-2"></i>
              {createPeriodMutation.isPending ? "Creating..." : "Create Payroll Schedule"}
            </Button>
          </CardContent>
        </Card>

        {/* Pay Periods List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pay Periods</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {payPeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center">No pay periods found</p>
            ) : (
              payPeriods.slice(0, 5).map((period) => (
                <div
                  key={period.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedPeriodId === period.id ? 'bg-blue-50 border-blue-200' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedPeriodId(period.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">
                      {formatDate(period.startDate.toString())} - {formatDate(period.endDate.toString())}
                    </div>
                    <div className="flex items-center gap-2">
                      {getWorkflowStateBadge(period.workflowState || 'created')}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Download CSV"
                        onClick={(e) => {
                          e.stopPropagation();
                          const sd = new Date(period.startDate).toISOString().split('T')[0];
                          const ed = new Date(period.endDate).toISOString().split('T')[0];
                          window.open(`/api/payroll/export?startDate=${sd}&endDate=${ed}`, '_blank');
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {period.isProcessed ? 'Processed' : 'In Progress'}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Workflow Logs */}
        {selectedPeriodId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Workflow Logs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {workflowLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center">No logs available</p>
              ) : (
                workflowLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="p-2 bg-muted/30 rounded text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{log.workflowStep.replace(/_/g, ' ')}</span>
                      <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                        {log.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1">{log.details}</p>
                    <p className="text-muted-foreground">
                      {log.createdAt ? new Date(log.createdAt).toLocaleString() : 'Unknown time'}
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