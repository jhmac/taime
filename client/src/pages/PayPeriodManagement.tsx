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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Download, Calendar, CalendarClock, RefreshCw, ChevronRight, Settings2, Gift, Plus, Trash2, Sparkles, AlertTriangle, CheckCircle, Clock, Edit2, Send, FileText, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { PayrollPeriod, PayPeriodSettings, WorkflowLog, Permission, HolidayPayRule } from "@shared/schema";

function getNthWeekday(year: number, month: number, weekday: number, n: number): { month: number; day: number } {
  const firstDay = new Date(year, month - 1, 1);
  let dayOfWeek = firstDay.getDay();
  let day = 1 + ((weekday - dayOfWeek + 7) % 7) + (n - 1) * 7;
  return { month, day };
}

function getLastMonday(year: number, month: number): { month: number; day: number } {
  const lastDay = new Date(year, month, 0);
  const diff = (lastDay.getDay() - 1 + 7) % 7;
  return { month, day: lastDay.getDate() - diff };
}

function getThanksgiving(year: number): { month: number; day: number } {
  return getNthWeekday(year, 11, 4, 4);
}

function getSuggestedHolidays(year: number) {
  const mlk = getNthWeekday(year, 1, 1, 3);
  const presidents = getNthWeekday(year, 2, 1, 3);
  const memorial = getLastMonday(year, 5);
  const labor = getNthWeekday(year, 9, 1, 1);
  const columbus = getNthWeekday(year, 10, 1, 2);
  const thanksgiving = getThanksgiving(year);
  const blackFriday = { month: 11, day: thanksgiving.day + 1 };

  return [
    { name: "New Year's Day", month: 1, day: 1, payMultiplier: 1.5 },
    { name: "Martin Luther King Jr. Day", month: mlk.month, day: mlk.day, payMultiplier: 1.5 },
    { name: "Presidents' Day", month: presidents.month, day: presidents.day, payMultiplier: 1.5 },
    { name: "Memorial Day", month: memorial.month, day: memorial.day, payMultiplier: 1.5 },
    { name: "Juneteenth", month: 6, day: 19, payMultiplier: 1.5 },
    { name: "Independence Day", month: 7, day: 4, payMultiplier: 1.5 },
    { name: "Labor Day", month: labor.month, day: labor.day, payMultiplier: 1.5 },
    { name: "Columbus Day", month: columbus.month, day: columbus.day, payMultiplier: 1.5 },
    { name: "Veterans Day", month: 11, day: 11, payMultiplier: 1.5 },
    { name: "Thanksgiving Day", month: thanksgiving.month, day: thanksgiving.day, payMultiplier: 1.5 },
    { name: "Black Friday", month: blackFriday.month, day: blackFriday.day, payMultiplier: 1.5 },
    { name: "Christmas Eve", month: 12, day: 24, payMultiplier: 1.5 },
    { name: "Christmas Day", month: 12, day: 25, payMultiplier: 1.5 },
    { name: "New Year's Eve", month: 12, day: 31, payMultiplier: 1.5 },
  ];
}

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
  const [selectedHolidays, setSelectedHolidays] = useState<Set<string>>(new Set());
  const [defaultMultiplier, setDefaultMultiplier] = useState("1.50");
  const [customHolidayName, setCustomHolidayName] = useState("");
  const [customHolidayDate, setCustomHolidayDate] = useState("");
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const suggestedHolidays = getSuggestedHolidays(holidayYear);
  const [payDayOfWeek, setPayDayOfWeek] = useState(5);
  const [expandedEmployee, setExpandedEmployee] = useState<string>("");
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [editClockOut, setEditClockOut] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");

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

  const { data: holidayPayRules = [] } = useQuery<HolidayPayRule[]>({
    queryKey: ['/api/holiday-pay-rules'],
  });

  const { data: reviewData, isLoading: reviewLoading } = useQuery<any>({
    queryKey: ['/api/payroll/periods', selectedPeriodId, 'review'],
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
      setPayDayOfWeek(settings.payDayOfWeek ?? 5);
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
        payDayOfWeek,
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

  const saveHolidaysMutation = useMutation({
    mutationFn: async (holidays: Array<{ name: string; month: number; day: number; payMultiplier: number }>) => {
      const res = await apiRequest('POST', '/api/holiday-pay-rules/bulk', { holidays });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/holiday-pay-rules'] });
      setSelectedHolidays(new Set());
      toast({ title: "Holidays saved", description: `${data.count} holiday pay rule${data.count > 1 ? 's' : ''} saved.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save holidays.", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (periodId: string) => {
      const res = await apiRequest('POST', `/api/payroll/periods/${periodId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/periods'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/periods', selectedPeriodId, 'review'] });
      toast({ title: "Approved", description: "Payroll has been approved and marked as processed." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to approve.", variant: "destructive" });
    },
  });

  const editTimeMutation = useMutation({
    mutationFn: async ({ entryId, updates }: { entryId: string; updates: any }) => {
      const res = await apiRequest('PATCH', `/api/time-entries/${entryId}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll/periods', selectedPeriodId, 'review'] });
      setEditingEntry(null);
      setEditClockOut("");
      toast({ title: "Updated", description: "Time entry has been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update.", variant: "destructive" });
    },
  });

  const emailExportMutation = useMutation({
    mutationFn: async ({ periodId, email }: { periodId: string; email: string }) => {
      const res = await apiRequest('POST', `/api/payroll/periods/${periodId}/email-export`, { email });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Sent", description: data.message });
      setAccountantEmail("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to email.", variant: "destructive" });
    },
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/holiday-pay-rules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/holiday-pay-rules'] });
      toast({ title: "Removed", description: "Holiday pay rule removed." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to remove.", variant: "destructive" });
    },
  });

  function toggleHoliday(key: string) {
    setSelectedHolidays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleSaveSelectedHolidays() {
    const multiplier = parseFloat(defaultMultiplier) || 1.5;
    const holidays = suggestedHolidays
      .filter(h => selectedHolidays.has(`${h.month}-${h.day}`))
      .map(h => ({ ...h, payMultiplier: multiplier }));
    if (holidays.length === 0) {
      toast({ title: "Select holidays", description: "Please check at least one holiday.", variant: "destructive" });
      return;
    }
    saveHolidaysMutation.mutate(holidays);
  }

  function handleAddCustomHoliday() {
    if (!customHolidayName.trim() || !customHolidayDate) {
      toast({ title: "Missing info", description: "Please enter a name and date for the custom holiday.", variant: "destructive" });
      return;
    }
    const d = new Date(customHolidayDate + 'T00:00:00');
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const multiplier = parseFloat(defaultMultiplier) || 1.5;
    saveHolidaysMutation.mutate([{ name: customHolidayName.trim(), month, day, payMultiplier: multiplier }]);
    setCustomHolidayName("");
    setCustomHolidayDate("");
  }

  function isHolidayAlreadySaved(month: number, day: number) {
    return holidayPayRules.some(r => r.month === month && r.day === day);
  }

  const monthName = (m: number) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1];

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

            <div>
              <Label className="text-sm font-medium">Pay Day</Label>
              <p className="text-xs text-muted-foreground mb-1">Which day of the week do you pay employees?</p>
              <Select value={String(payDayOfWeek)} onValueChange={(v) => setPayDayOfWeek(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                    <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                  ))}
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

        {/* Holiday Pay Calendar */}
        {canManagePayroll && <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4" />
              Holiday Pay Calendar
            </CardTitle>
            <CardDescription>
              Select which holidays should receive time-and-a-half (or custom multiplier) pay. Check the ones you want from the suggested list below, or add your own.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm whitespace-nowrap">Year</Label>
                <Select value={String(holidayYear)} onValueChange={(v) => { setHolidayYear(Number(v)); setSelectedHolidays(new Set()); }}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Label className="text-sm whitespace-nowrap">Pay multiplier</Label>
              <Select value={defaultMultiplier} onValueChange={setDefaultMultiplier}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1.25">1.25x (Time + quarter)</SelectItem>
                  <SelectItem value="1.50">1.5x (Time and a half)</SelectItem>
                  <SelectItem value="2.00">2x (Double time)</SelectItem>
                  <SelectItem value="2.50">2.5x (Double time + half)</SelectItem>
                  <SelectItem value="3.00">3x (Triple time)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <Label className="text-sm font-medium">Suggested Holidays</Label>
                <Badge variant="outline" className="text-[10px]">AI Recommended</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {suggestedHolidays.map((h) => {
                  const key = `${h.month}-${h.day}`;
                  const alreadySaved = isHolidayAlreadySaved(h.month, h.day);
                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                        alreadySaved
                          ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                          : selectedHolidays.has(key)
                          ? 'bg-primary/5 border-primary/30'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <Checkbox
                        checked={alreadySaved || selectedHolidays.has(key)}
                        disabled={alreadySaved}
                        onCheckedChange={() => toggleHoliday(key)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{h.name}</p>
                        <p className="text-xs text-muted-foreground">{monthName(h.month)} {h.day}</p>
                      </div>
                      {alreadySaved && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">Saved</Badge>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedHolidays.size > 0 && (
                <Button
                  className="w-full mt-3"
                  onClick={handleSaveSelectedHolidays}
                  disabled={saveHolidaysMutation.isPending}
                >
                  {saveHolidaysMutation.isPending
                    ? 'Saving...'
                    : `Save ${selectedHolidays.size} selected holiday${selectedHolidays.size > 1 ? 's' : ''} at ${defaultMultiplier}x pay`
                  }
                </Button>
              )}
            </div>

            <Separator />

            <div>
              <Label className="text-sm font-medium mb-2 block">Add Custom Holiday</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Holiday name (e.g. Company Day)"
                  value={customHolidayName}
                  onChange={(e) => setCustomHolidayName(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="date"
                  value={customHolidayDate}
                  onChange={(e) => setCustomHolidayDate(e.target.value)}
                  className="w-full sm:w-40"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-9"
                  onClick={handleAddCustomHoliday}
                  disabled={saveHolidaysMutation.isPending}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
            </div>

            {holidayPayRules.length > 0 && (
              <>
                <Separator />
                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    Active Holiday Pay Rules ({holidayPayRules.length})
                  </Label>
                  <div className="space-y-1.5">
                    {holidayPayRules.map((rule) => (
                      <div key={rule.id} className="flex items-center justify-between p-2.5 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {monthName(rule.month)}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{rule.name}</p>
                            <p className="text-xs text-muted-foreground">{monthName(rule.month)} {rule.day}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{rule.payMultiplier}x</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => deleteHolidayMutation.mutate(rule.id)}
                            disabled={deleteHolidayMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>}

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

        {/* Detailed Payroll Review */}
        {selectedPeriodId && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Payroll Review
                  </CardTitle>
                  <CardDescription>
                    {reviewData ? `${reviewData.employees?.length || 0} employees` : 'Loading...'}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {reviewData && !reviewData.period?.processedAt && (
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(selectedPeriodId)}
                      disabled={approveMutation.isPending}
                      className="gap-1"
                    >
                      <CheckCircle className="h-3 w-3" />
                      {approveMutation.isPending ? 'Approving...' : 'Approve Payroll'}
                    </Button>
                  )}
                  {reviewData?.period?.processedAt && (
                    <Badge className="bg-green-600 text-white">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Approved {new Date(reviewData.period.processedAt).toLocaleDateString()}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviewLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">Loading payroll data...</p>
              ) : reviewData?.employees?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No employee data for this period.</p>
              ) : (
                <>
                  {/* Summary Stats */}
                  {reviewData && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                      <div className="p-2 bg-muted/30 rounded text-center">
                        <p className="text-lg font-bold">{reviewData.employees?.length || 0}</p>
                        <p className="text-[10px] text-muted-foreground">Employees</p>
                      </div>
                      <div className="p-2 bg-muted/30 rounded text-center">
                        <p className="text-lg font-bold">
                          {reviewData.employees?.reduce((sum: number, e: any) => sum + (e.workedHours || 0), 0).toFixed(1)}h
                        </p>
                        <p className="text-[10px] text-muted-foreground">Total Hours</p>
                      </div>
                      <div className="p-2 bg-muted/30 rounded text-center">
                        <p className="text-lg font-bold">
                          ${reviewData.employees?.reduce((sum: number, e: any) => sum + (e.totalPay || 0), 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Total Pay</p>
                      </div>
                      <div className="p-2 bg-muted/30 rounded text-center">
                        <p className="text-lg font-bold text-yellow-600">
                          {reviewData.employees?.reduce((sum: number, e: any) => sum + (e.discrepancies?.length || 0), 0)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Discrepancies</p>
                      </div>
                    </div>
                  )}

                  {/* Employee List */}
                  {reviewData?.employees?.map((emp: any) => (
                    <div key={emp.userId} className="border rounded-lg overflow-hidden">
                      <div
                        className="p-3 flex items-center justify-between cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpandedEmployee(expandedEmployee === emp.userId ? '' : emp.userId)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold">
                            {(emp.firstName?.[0] || '') + (emp.lastName?.[0] || '')}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{emp.firstName} {emp.lastName}</p>
                            <p className="text-xs text-muted-foreground">
                              {emp.workedHours?.toFixed(1)}h worked
                              {emp.overtimeHours > 0 && <span className="text-orange-500 ml-1">({emp.overtimeHours.toFixed(1)}h OT)</span>}
                              {emp.scheduledHours > 0 && <span className="ml-1">/ {emp.scheduledHours.toFixed(1)}h scheduled</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {emp.discrepancies?.length > 0 && (
                            <Badge variant="destructive" className="text-[10px] gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              {emp.discrepancies.length}
                            </Badge>
                          )}
                          <span className="text-sm font-medium">${emp.totalPay?.toFixed(2)}</span>
                          <ChevronRight className={`h-4 w-4 transition-transform ${expandedEmployee === emp.userId ? 'rotate-90' : ''}`} />
                        </div>
                      </div>

                      {/* Expanded Employee Details */}
                      {expandedEmployee === emp.userId && (
                        <div className="border-t p-3 bg-muted/10 space-y-3">
                          {/* Hours Breakdown */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div className="p-2 bg-background rounded">
                              <p className="text-muted-foreground">Regular Hours</p>
                              <p className="font-medium">{emp.regularHours?.toFixed(1)}h</p>
                            </div>
                            <div className="p-2 bg-background rounded">
                              <p className="text-muted-foreground">Overtime</p>
                              <p className="font-medium text-orange-500">{emp.overtimeHours?.toFixed(1)}h</p>
                            </div>
                            <div className="p-2 bg-background rounded">
                              <p className="text-muted-foreground">Holiday Pay</p>
                              <p className="font-medium text-green-600">${emp.holidayPay?.toFixed(2) || '0.00'}</p>
                            </div>
                            <div className="p-2 bg-background rounded">
                              <p className="text-muted-foreground">Total Pay</p>
                              <p className="font-bold">${emp.totalPay?.toFixed(2)}</p>
                            </div>
                          </div>

                          {/* Discrepancies */}
                          {emp.discrepancies?.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-medium flex items-center gap-1 text-yellow-600">
                                <AlertTriangle className="h-3 w-3" /> Discrepancies
                              </p>
                              {emp.discrepancies.map((d: any, i: number) => (
                                <div key={i} className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs flex items-start gap-2">
                                  <AlertTriangle className="h-3 w-3 mt-0.5 text-yellow-600 flex-shrink-0" />
                                  <div>
                                    <p className="font-medium">{d.type === 'missing_clock_out' ? 'Missing Clock Out' : d.type === 'no_show' ? 'No Show' : d.type}</p>
                                    <p className="text-muted-foreground">{d.description}</p>
                                    {d.scheduledShift && (
                                      <p className="text-muted-foreground">Scheduled: {d.scheduledShift.start} - {d.scheduledShift.end}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Time Entries */}
                          {emp.timeEntries?.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-medium flex items-center gap-1">
                                <Clock className="h-3 w-3" /> Time Cards
                              </p>
                              {emp.timeEntries.map((entry: any) => (
                                <div key={entry.id} className="p-2 bg-background rounded text-xs flex items-center justify-between">
                                  <div>
                                    <p className="font-medium">
                                      {new Date(entry.clockInTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </p>
                                    <p className="text-muted-foreground">
                                      {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                      {entry.clockOutTime ? ` - ${new Date(entry.clockOutTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ' - Missing'}
                                    </p>
                                    {entry.hours != null && <p className="text-muted-foreground">{Number(entry.hours).toFixed(2)}h</p>}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {!entry.clockOutTime && (
                                      <Badge variant="destructive" className="text-[10px]">Open</Badge>
                                    )}
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0"
                                          onClick={() => {
                                            setEditingEntry(entry);
                                            setEditClockOut(entry.clockOutTime ? new Date(entry.clockOutTime).toISOString().slice(0, 16) : '');
                                          }}
                                        >
                                          <Edit2 className="h-3 w-3" />
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle>Edit Time Entry</DialogTitle>
                                        </DialogHeader>
                                        <div className="space-y-3">
                                          <div>
                                            <Label className="text-sm">Clock In</Label>
                                            <p className="text-sm text-muted-foreground">
                                              {new Date(entry.clockInTime).toLocaleString()}
                                            </p>
                                          </div>
                                          <div>
                                            <Label className="text-sm">Clock Out</Label>
                                            <Input
                                              type="datetime-local"
                                              value={editingEntry?.id === entry.id ? editClockOut : ''}
                                              onChange={(e) => setEditClockOut(e.target.value)}
                                            />
                                          </div>
                                        </div>
                                        <DialogFooter>
                                          <DialogClose asChild>
                                            <Button variant="outline" size="sm">Cancel</Button>
                                          </DialogClose>
                                          <DialogClose asChild>
                                            <Button
                                              size="sm"
                                              disabled={editTimeMutation.isPending}
                                              onClick={() => {
                                                if (editClockOut) {
                                                  editTimeMutation.mutate({
                                                    entryId: entry.id,
                                                    updates: { clockOutTime: new Date(editClockOut).toISOString() },
                                                  });
                                                }
                                              }}
                                            >
                                              Save
                                            </Button>
                                          </DialogClose>
                                        </DialogFooter>
                                      </DialogContent>
                                    </Dialog>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Export Actions */}
                  <Separator />
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        const period = payPeriods.find(p => p.id === selectedPeriodId);
                        if (period) {
                          const sd = new Date(period.startDate).toISOString().split('T')[0];
                          const ed = new Date(period.endDate).toISOString().split('T')[0];
                          window.open(`/api/payroll/export?startDate=${sd}&endDate=${ed}`, '_blank');
                        }
                      }}
                    >
                      <Download className="h-3 w-3" />
                      Export CSV
                    </Button>

                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1">
                          <Send className="h-3 w-3" />
                          Email to Accountant
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Email Payroll Report</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div>
                            <Label className="text-sm">Accountant Email</Label>
                            <Input
                              type="email"
                              placeholder="accountant@company.com"
                              value={accountantEmail}
                              onChange={(e) => setAccountantEmail(e.target.value)}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <DialogClose asChild>
                            <Button variant="outline" size="sm">Cancel</Button>
                          </DialogClose>
                          <DialogClose asChild>
                            <Button
                              size="sm"
                              disabled={!accountantEmail || emailExportMutation.isPending}
                              onClick={() => {
                                emailExportMutation.mutate({ periodId: selectedPeriodId, email: accountantEmail });
                              }}
                            >
                              <Send className="h-3 w-3 mr-1" />
                              Send
                            </Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

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
