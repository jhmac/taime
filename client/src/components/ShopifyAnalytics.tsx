import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Clipboard, Check, Mail, Send, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

type TimeRange = 'daily' | 'weekly' | 'monthly' | 'quarterly';
type ReportFrequency = 'daily' | 'weekly' | 'monthly';

interface ReportSchedule {
  id: string;
  shopDomain: string;
  frequency: ReportFrequency;
  recipientEmail: string;
  enabled: boolean;
  lastSentAt: string | null;
}

const TIME_RANGES: { key: TimeRange; label: string; daysBack: number }[] = [
  { key: 'daily',     label: 'Daily',     daysBack: 1  },
  { key: 'weekly',    label: 'Weekly',    daysBack: 7  },
  { key: 'monthly',   label: 'Monthly',   daysBack: 30 },
  { key: 'quarterly', label: 'Quarterly', daysBack: 90 },
];

interface DailyBreakdown {
  date: string;
  revenue: number;
  laborCost: number;
  percentage: number;
}

interface LaborCostRatioData {
  totalRevenue: number;
  totalLaborCost: number;
  laborCostPercentage: number;
  daysBack: number;
  dailyBreakdown: DailyBreakdown[];
}

interface WeeklyBreakdown {
  week: string;
  revenue: number;
  laborCost: number;
  percentage: number;
}

function aggregateByWeek(daily: DailyBreakdown[]): WeeklyBreakdown[] {
  const buckets = new Map<string, { revenue: number; laborCost: number }>();
  for (const d of daily) {
    const dt = new Date(d.date + 'T00:00:00');
    const dow = dt.getDay();
    const weekStart = new Date(dt);
    weekStart.setDate(dt.getDate() - dow);
    const key = weekStart.toISOString().split('T')[0];
    const existing = buckets.get(key) ?? { revenue: 0, laborCost: 0 };
    buckets.set(key, {
      revenue: existing.revenue + d.revenue,
      laborCost: existing.laborCost + d.laborCost,
    });
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => ({
      week,
      revenue: Math.round(data.revenue * 100) / 100,
      laborCost: Math.round(data.laborCost * 100) / 100,
      percentage: data.revenue > 0
        ? Math.round((data.laborCost / data.revenue) * 10000) / 100
        : 0,
    }));
}

function getPercentageColor(pct: number) {
  if (pct < 30) return 'text-green-600 dark:text-green-400';
  if (pct <= 40) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function getPercentageBg(pct: number) {
  if (pct < 30) return 'bg-green-100 dark:bg-green-900/30';
  if (pct <= 40) return 'bg-yellow-100 dark:bg-yellow-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

function getPercentageLabel(pct: number) {
  if (pct < 30) return 'Healthy';
  if (pct <= 40) return 'Moderate';
  return 'High';
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWeek(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return 'Wk ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getExportFilename(timeRange: TimeRange, daysBack: number, dataStart?: string, dataEnd?: string): string {
  const today = new Date();
  const fallbackStart = new Date(today);
  fallbackStart.setDate(today.getDate() - daysBack + 1);
  const todayStr = dataEnd ?? today.toISOString().split('T')[0];
  const startStr = dataStart ?? fallbackStart.toISOString().split('T')[0];

  if (timeRange === 'daily') {
    return `shopify-analytics-${todayStr}.csv`;
  }
  return `shopify-analytics-${startStr}-to-${todayStr}.csv`;
}

function buildCsv(rows: { label: string; revenue: number; laborCost: number; percentage: number }[], isQuarterly: boolean): string {
  const header = [isQuarterly ? 'Week of' : 'Date', 'Revenue', 'Labor Cost', 'Labor %'].join(',');
  const lines = rows.map(r =>
    [r.label, r.revenue.toFixed(2), r.laborCost.toFixed(2), r.percentage.toFixed(2)].join(',')
  );
  return [header, ...lines].join('\n');
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ShopifyAnalytics({ shopDomain }: { shopDomain: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const roleName = (user as any)?.role?.name;
  const isAdminOrOwner = roleName === 'owner' || roleName === 'admin';
  const { data: permissions = [] } = useQuery<{ name: string }[]>({
    queryKey: ['/api/auth/permissions'],
    enabled: !!user && !isAdminOrOwner,
    staleTime: 5 * 60 * 1000,
  });
  const hasSalesView = isAdminOrOwner || permissions.some(p => p.name === 'sales.view_all' || p.name === 'admin.manage_all');

  const [timeRange, setTimeRange] = useState<TimeRange>('monthly');
  const [copied, setCopied] = useState(false);
  const selectedRange = TIME_RANGES.find(r => r.key === timeRange)!;

  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [scheduleEmail, setScheduleEmail] = useState('');
  const [scheduleFrequency, setScheduleFrequency] = useState<ReportFrequency>('weekly');
  const [scheduleEnabled, setScheduleEnabled] = useState(true);

  const { data: reportSchedule, isLoading: scheduleLoading } = useQuery<ReportSchedule | null>({
    queryKey: ['/api/shopify/report-schedule', shopDomain],
    queryFn: async () => {
      const res = await fetch(`/api/shopify/report-schedule?shop=${encodeURIComponent(shopDomain)}`, { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!shopDomain && isAdminOrOwner,
  });

  const saveScheduleMutation = useMutation({
    mutationFn: async (payload: { shopDomain: string; frequency: string; recipientEmail: string; enabled: boolean }) => {
      return apiRequest('POST', '/api/shopify/report-schedule', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/report-schedule', shopDomain] });
      toast({ description: 'Report schedule saved.' });
    },
    onError: () => {
      toast({ description: 'Failed to save report schedule.', variant: 'destructive' });
    },
  });

  const sendNowMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/shopify/report-schedule/send-now', { shopDomain });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/report-schedule', shopDomain] });
      toast({ description: 'Report sent successfully.' });
    },
    onError: () => {
      toast({ description: 'Failed to send report. Check SendGrid configuration.', variant: 'destructive' });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', `/api/shopify/report-schedule?shop=${encodeURIComponent(shopDomain)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/report-schedule', shopDomain] });
      toast({ description: 'Report schedule removed.' });
      setShowSchedulePanel(false);
    },
    onError: () => {
      toast({ description: 'Failed to remove schedule.', variant: 'destructive' });
    },
  });

  function handleOpenSchedulePanel() {
    if (reportSchedule) {
      setScheduleEmail(reportSchedule.recipientEmail);
      setScheduleFrequency(reportSchedule.frequency);
      setScheduleEnabled(reportSchedule.enabled);
    }
    setShowSchedulePanel(true);
  }

  function handleSaveSchedule() {
    if (!scheduleEmail.trim() || !scheduleEmail.includes('@')) {
      toast({ description: 'Please enter a valid email address.', variant: 'destructive' });
      return;
    }
    saveScheduleMutation.mutate({ shopDomain, frequency: scheduleFrequency, recipientEmail: scheduleEmail.trim(), enabled: scheduleEnabled });
  }

  const { data, isLoading } = useQuery<LaborCostRatioData>({
    queryKey: ['/api/shopify/labor-cost-ratio', shopDomain, selectedRange.daysBack],
    queryFn: async () => {
      const res = await fetch(
        `/api/shopify/labor-cost-ratio?shop=${encodeURIComponent(shopDomain)}&daysBack=${selectedRange.daysBack}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to fetch labor cost ratio');
      return res.json();
    },
    enabled: !!shopDomain,
  });

  const { data: staffingData } = useQuery<any>({
    queryKey: ['/api/shopify/staffing-recommendations', shopDomain],
    queryFn: async () => {
      const res = await fetch(`/api/shopify/staffing-recommendations?shop=${encodeURIComponent(shopDomain)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch staffing recommendations');
      return res.json();
    },
    enabled: !!shopDomain,
  });

  if (!hasSalesView) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">You don't have access to sales data.</p>
      </div>
    );
  }

  const isQuarterly = timeRange === 'quarterly';

  function buildCurrentCsv() {
    if (!data) return '';
    const sorted = [...data.dailyBreakdown].sort((a, b) => a.date.localeCompare(b.date));
    const rows = isQuarterly
      ? aggregateByWeek(data.dailyBreakdown).map(w => ({ label: w.week, revenue: w.revenue, laborCost: w.laborCost, percentage: w.percentage }))
      : sorted.map(d => ({ label: d.date, revenue: d.revenue, laborCost: d.laborCost, percentage: d.percentage }));
    return buildCsv(rows, isQuarterly);
  }

  function handleExportCsv() {
    if (!data) return;
    const sorted = [...data.dailyBreakdown].sort((a, b) => a.date.localeCompare(b.date));
    const dataStart = sorted[0]?.date;
    const dataEnd = sorted[sorted.length - 1]?.date;
    const csv = buildCurrentCsv();
    const filename = getExportFilename(timeRange, selectedRange.daysBack, dataStart, dataEnd);
    downloadCsv(csv, filename);
  }

  async function handleCopyCsv() {
    const csv = buildCurrentCsv();
    if (!csv) return;
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      toast({ description: 'CSV copied to clipboard.' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ description: 'Copy failed — try the Download button instead.', variant: 'destructive' });
    }
  }

  const chartData = isQuarterly && data
    ? aggregateByWeek(data.dailyBreakdown).map(w => ({ date: w.week, revenue: w.revenue, laborCost: w.laborCost, percentage: w.percentage }))
    : (data?.dailyBreakdown ?? []).map(d => ({ date: d.date, revenue: d.revenue, laborCost: d.laborCost, percentage: d.percentage }));

  const chartLabelFn = isQuarterly ? formatWeek : formatDate;
  const chartTitle = isQuarterly
    ? 'Revenue vs Labor Cost (by Week — 90 Days)'
    : `Revenue vs Labor Cost (${selectedRange.label} — ${selectedRange.daysBack}d)`;

  const tableRows = isQuarterly && data
    ? aggregateByWeek(data.dailyBreakdown)
    : (data?.dailyBreakdown ?? []).slice().reverse().slice(0, 14);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <i className="fab fa-shopify text-muted-foreground text-3xl mb-3"></i>
          <p className="text-sm text-muted-foreground">Unable to load Shopify analytics data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <i className="fab fa-shopify text-green-600 text-lg"></i>
          <h2 className="text-base font-semibold">Shopify Revenue vs Labor Cost</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border bg-muted/30 p-1 gap-1">
            {TIME_RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setTimeRange(r.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  timeRange === r.key
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyCsv}
              disabled={!data}
              className="text-xs h-8 w-8 p-0"
              title="Copy CSV to clipboard"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Clipboard className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={!data}
              className="text-xs h-8 gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </Button>
            {isAdminOrOwner && (
              <Button
                variant={reportSchedule?.enabled ? 'default' : 'outline'}
                size="sm"
                onClick={handleOpenSchedulePanel}
                className="text-xs h-8 gap-1.5"
                title="Configure scheduled email report"
              >
                <Mail className="h-3.5 w-3.5" />
                {reportSchedule?.enabled ? 'Report On' : 'Schedule'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full ${getPercentageBg(data.laborCostPercentage)} flex items-center justify-center flex-shrink-0`}>
                <i className={`fas fa-percentage ${getPercentageColor(data.laborCostPercentage)} text-lg`}></i>
              </div>
              <div>
                <p className={`text-3xl font-bold ${getPercentageColor(data.laborCostPercentage)}`}>
                  {data.laborCostPercentage}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Labor Cost Ratio · {getPercentageLabel(data.laborCostPercentage)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-dollar-sign text-blue-600 dark:text-blue-400 text-lg"></i>
              </div>
              <div>
                <p className="text-2xl font-bold">${data.totalRevenue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Revenue ({data.daysBack}d)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-users text-amber-600 dark:text-amber-400 text-lg"></i>
              </div>
              <div>
                <p className="text-2xl font-bold">${data.totalLaborCost.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Labor Cost ({data.daysBack}d)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-chart-bar text-primary"></i>
            {chartTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tickFormatter={chartLabelFn}
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `$${value.toFixed(2)}`,
                    name === 'revenue' ? 'Revenue' : 'Labor Cost',
                  ]}
                  labelFormatter={chartLabelFn}
                />
                <Legend formatter={(value) => value === 'revenue' ? 'Revenue' : 'Labor Cost'} />
                <Bar dataKey="revenue" fill="hsl(200, 80%, 50%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="laborCost" fill="hsl(30, 80%, 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-12">
              <i className="fas fa-chart-bar text-muted-foreground text-3xl mb-3"></i>
              <p className="text-sm text-muted-foreground">No data available for this period</p>
            </div>
          )}
        </CardContent>
      </Card>

      {staffingData?.aiInsight && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-robot text-primary"></i>
              AI Staffing Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{staffingData.aiInsight}</p>
          </CardContent>
        </Card>
      )}

      {tableRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-table text-primary"></i>
              {isQuarterly ? 'Weekly Breakdown' : 'Daily Breakdown'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">
                      {isQuarterly ? 'Week of' : 'Date'}
                    </th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Labor Cost</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Labor %</th>
                  </tr>
                </thead>
                <tbody>
                  {isQuarterly
                    ? (tableRows as WeeklyBreakdown[]).slice().reverse().map((row) => (
                        <tr key={row.week} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-2 px-2">{formatDate(row.week)}</td>
                          <td className="text-right py-2 px-2">${row.revenue.toLocaleString()}</td>
                          <td className="text-right py-2 px-2">${row.laborCost.toLocaleString()}</td>
                          <td className={`text-right py-2 px-2 font-medium ${getPercentageColor(row.percentage)}`}>
                            {row.percentage}%
                          </td>
                        </tr>
                      ))
                    : (tableRows as DailyBreakdown[]).map((day) => (
                        <tr key={day.date} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-2 px-2">{formatDate(day.date)}</td>
                          <td className="text-right py-2 px-2">${day.revenue.toLocaleString()}</td>
                          <td className="text-right py-2 px-2">${day.laborCost.toLocaleString()}</td>
                          <td className={`text-right py-2 px-2 font-medium ${getPercentageColor(day.percentage)}`}>
                            {day.percentage}%
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdminOrOwner && showSchedulePanel && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                Scheduled Email Report
              </span>
              <button
                onClick={() => setShowSchedulePanel(false)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {reportSchedule && (
              <div className="text-xs text-muted-foreground bg-background rounded-md p-3 border">
                <span className="font-medium">Current schedule: </span>
                <span className="capitalize">{reportSchedule.frequency}</span> to{' '}
                <span className="font-medium">{reportSchedule.recipientEmail}</span>
                {reportSchedule.enabled ? (
                  <span className="ml-2 text-green-600 font-medium">· Active</span>
                ) : (
                  <span className="ml-2 text-muted-foreground">· Paused</span>
                )}
                {reportSchedule.lastSentAt && (
                  <span className="ml-2">
                    · Last sent {new Date(reportSchedule.lastSentAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Recipient Email</Label>
                <Input
                  type="email"
                  placeholder="manager@store.com"
                  value={scheduleEmail}
                  onChange={e => setScheduleEmail(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Frequency</Label>
                <Select value={scheduleFrequency} onValueChange={v => setScheduleFrequency(v as ReportFrequency)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="schedule-enabled"
                checked={scheduleEnabled}
                onCheckedChange={setScheduleEnabled}
              />
              <Label htmlFor="schedule-enabled" className="text-xs cursor-pointer">
                {scheduleEnabled ? 'Schedule enabled' : 'Schedule paused'}
              </Label>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={handleSaveSchedule}
                disabled={saveScheduleMutation.isPending}
                className="text-xs h-8 gap-1.5"
              >
                {saveScheduleMutation.isPending ? 'Saving…' : 'Save Schedule'}
              </Button>
              {reportSchedule && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => sendNowMutation.mutate()}
                    disabled={sendNowMutation.isPending}
                    className="text-xs h-8 gap-1.5"
                  >
                    <Send className="h-3 w-3" />
                    {sendNowMutation.isPending ? 'Sending…' : 'Send Now'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteScheduleMutation.mutate()}
                    disabled={deleteScheduleMutation.isPending}
                    className="text-xs h-8 text-destructive hover:text-destructive"
                  >
                    {deleteScheduleMutation.isPending ? 'Removing…' : 'Remove Schedule'}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
