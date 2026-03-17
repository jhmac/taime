import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import ShopifyAnalytics from '@/components/ShopifyAnalytics';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface LaborCostDay {
  date: string;
  totalHours: number;
  totalCost: number;
  employeeCount: number;
}

interface EmployeePunctuality {
  userId: string;
  name: string;
  onTime: number;
  late: number;
  total: number;
  percentage: number;
}

interface WeeklyComparison {
  thisWeek: { hours: number; cost: number; tasksCompleted: number; tasksTotal: number };
  lastWeek: { hours: number; cost: number; tasksCompleted: number; tasksTotal: number };
}

interface DashboardData {
  laborCostByDay: LaborCostDay[];
  punctualityScore: { onTime: number; late: number; total: number; percentage: number };
  taskCompletion: { completed: number; total: number; percentage: number };
  teamSummary: { activeNow: number; totalHoursToday: number; tasksCompletedToday: number; totalEmployees: number };
  employeePunctualityBreakdown: EmployeePunctuality[];
  weeklyComparison: WeeklyComparison;
}

interface Anomaly {
  type: string;
  userId: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  recommendation: string;
}

interface AnomalyResult {
  anomalies: Anomaly[];
  patterns: Record<string, unknown>;
}

function ComparisonIndicator({ current, previous, format = 'number' }: { current: number; previous: number; format?: 'number' | 'currency' | 'hours' }) {
  if (previous === 0 && current === 0) return null;
  const diff = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
  const isPositive = diff > 0;
  const isNeutral = diff === 0;

  const formatVal = (v: number) => {
    if (format === 'currency') return `$${v.toFixed(0)}`;
    if (format === 'hours') return `${v.toFixed(1)}h`;
    return v.toString();
  };

  return (
    <div className="flex items-center gap-1 mt-1">
      {!isNeutral && (
        <i className={`fas fa-arrow-${isPositive ? 'up' : 'down'} text-[10px] ${isPositive ? 'text-green-500' : 'text-red-500'}`}></i>
      )}
      <span className={`text-[10px] ${isNeutral ? 'text-muted-foreground' : isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        {isNeutral ? 'No change' : `${Math.abs(Math.round(diff))}% vs last week (${formatVal(previous)})`}
      </span>
    </div>
  );
}

const TIER_COLORS: Record<string, string> = {
  bronze: 'text-orange-600 bg-orange-50',
  silver: 'text-gray-600 bg-gray-50',
  gold: 'text-yellow-600 bg-yellow-50',
  platinum: 'text-blue-600 bg-blue-50',
  diamond: 'text-purple-600 bg-purple-50',
};

interface TeamScore {
  userId: string;
  firstName: string;
  lastName: string;
  overallScore: number;
  tier: string;
  rank: number;
  streakDays: number;
}

function TeamScoresSection() {
  const { data: teamScores = [], isLoading } = useQuery<TeamScore[]>({
    queryKey: ['/api/gamification/team-scores'],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Team Gamification Scores</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-40 w-full" /></CardContent>
      </Card>
    );
  }

  const tierCounts: Record<string, number> = {};
  const avgScore = teamScores.length > 0
    ? Math.round(teamScores.reduce((sum, s) => sum + s.overallScore, 0) / teamScores.length)
    : 0;

  teamScores.forEach(s => {
    tierCounts[s.tier] = (tierCounts[s.tier] || 0) + 1;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <i className="fas fa-trophy text-yellow-500"></i> Team Gamification Scores
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold">{avgScore}</div>
            <div className="text-xs text-muted-foreground">Avg Score</div>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold">{teamScores.length}</div>
            <div className="text-xs text-muted-foreground">Team Members</div>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold">{tierCounts['diamond'] || 0}</div>
            <div className="text-xs text-muted-foreground">Diamond</div>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-2xl font-bold">{tierCounts['platinum'] || 0}</div>
            <div className="text-xs text-muted-foreground">Platinum</div>
          </div>
        </div>

        {teamScores.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead className="text-center">Tier</TableHead>
                <TableHead className="text-center">Streak</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamScores.map((s: TeamScore) => {
                const tc = TIER_COLORS[s.tier] || TIER_COLORS.bronze;
                return (
                  <TableRow key={s.userId}>
                    <TableCell className="font-medium">{s.rank}</TableCell>
                    <TableCell>{s.firstName} {s.lastName?.charAt(0)}.</TableCell>
                    <TableCell className="text-center font-semibold">{s.overallScore}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`capitalize text-xs ${tc}`}>{s.tier}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {s.streakDays > 0 ? (
                        <span className="text-xs">🔥 {s.streakDays}d</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {teamScores.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No score data yet. Scores compute nightly.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface GamificationSettingsForm {
  tierThresholds: { bronze: number; silver: number; gold: number; platinum: number; diamond: number };
  prizeDescriptions: { gold: string; platinum: string; diamond: string };
}

function GamificationSettingsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<GamificationSettingsForm>({
    tierThresholds: { bronze: 0, silver: 40, gold: 60, platinum: 80, diamond: 95 },
    prizeDescriptions: { gold: '', platinum: '', diamond: '' },
  });

  const { data: settings, isLoading } = useQuery<GamificationSettingsForm & { scoreNotificationsEnabled: boolean }>({
    queryKey: ['/api/gamification/settings'],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: GamificationSettingsForm) => {
      return await apiRequest('PUT', '/api/gamification/settings', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/gamification/settings'] });
      toast({ title: 'Settings saved', description: 'Gamification settings updated successfully.' });
      setEditing(false);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    },
  });

  const startEditing = () => {
    if (settings) {
      setForm({
        tierThresholds: settings.tierThresholds || { bronze: 0, silver: 40, gold: 60, platinum: 80, diamond: 95 },
        prizeDescriptions: settings.prizeDescriptions || { gold: '', platinum: '', diamond: '' },
      });
    }
    setEditing(true);
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <i className="fas fa-sliders-h text-blue-500"></i> Gamification Settings
          </CardTitle>
          {!editing && (
            <Button size="sm" variant="outline" onClick={startEditing}>
              <i className="fas fa-edit mr-1"></i> Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Tier Thresholds (score 0-100)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {(['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const).map(tier => (
                  <div key={tier}>
                    <Label className="text-xs capitalize">{tier}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={form.tierThresholds[tier]}
                      onChange={(e) => setForm(prev => ({
                        ...prev,
                        tierThresholds: { ...prev.tierThresholds, [tier]: parseInt(e.target.value) || 0 }
                      }))}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Prize Descriptions</h4>
              <div className="space-y-2">
                {(['gold', 'platinum', 'diamond'] as const).map(tier => (
                  <div key={tier}>
                    <Label className="text-xs capitalize">{tier} Prize</Label>
                    <Input
                      value={form.prizeDescriptions[tier] || ''}
                      onChange={(e) => setForm(prev => ({
                        ...prev,
                        prizeDescriptions: { ...prev.prizeDescriptions, [tier]: e.target.value }
                      }))}
                      placeholder={`Reward for ${tier} tier...`}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Tier Thresholds</h4>
              <div className="flex flex-wrap gap-2">
                {settings && Object.entries(settings.tierThresholds).map(([tier, val]) => (
                  <Badge key={tier} variant="outline" className="capitalize text-xs">
                    {tier}: {val as number}+
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Prizes</h4>
              {settings && Object.entries(settings.prizeDescriptions).map(([tier, desc]) => (
                desc ? (
                  <div key={tier} className="text-xs text-muted-foreground">
                    <span className="capitalize font-medium">{tier}:</span> {desc as string}
                  </div>
                ) : null
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Analytics() {
  const isMobile = useIsMobile();
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['/api/analytics/dashboard'],
  });

  const { data: shopifyShops = [] } = useQuery<{ id: string; shopDomain: string; isActive: boolean }[]>({
    queryKey: ['/api/shopify/shops'],
  });

  const connectedShop = shopifyShops.find((s) => s.isActive);

  const anomalyScan = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/ai/detect-anomalies', {});
      return res.json() as Promise<AnomalyResult>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/insights'] });
    },
  });

  const severityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge variant="destructive">High</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">Medium</Badge>;
      default:
        return <Badge className="bg-blue-500 hover:bg-blue-600 text-white">Low</Badge>;
    }
  };

  const severityBorder = (severity: string) => {
    switch (severity) {
      case 'high': return 'border-l-4 border-l-red-500';
      case 'medium': return 'border-l-4 border-l-yellow-500';
      default: return 'border-l-4 border-l-blue-500';
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const punctualityColor = (pct: number) => {
    if (pct >= 90) return 'text-green-600 dark:text-green-400';
    if (pct >= 70) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const punctualityBg = (pct: number) => {
    if (pct >= 90) return 'bg-green-100 dark:bg-green-900/30';
    if (pct >= 70) return 'bg-yellow-100 dark:bg-yellow-900/30';
    return 'bg-red-100 dark:bg-red-900/30';
  };

  return (
    <div className="min-h-full bg-background">
      <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg md:text-xl font-bold">Analytics Dashboard</h1>
            <p className="text-sm opacity-80">Labor costs, punctuality & task insights</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <i className="fas fa-chart-bar"></i>
          </div>
        </div>
      </section>

      <div className={isMobile ? "px-4 py-3" : "px-6 py-4"}>
        {isLoading ? (
          <div className="space-y-4">
            <div className={isMobile ? "grid grid-cols-2 gap-3" : "grid grid-cols-4 gap-4"}>
              {[1, 2, 3, 4].map(i => (
                <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
              ))}
            </div>
            <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-4"}>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
              <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
            </div>
          </div>
        ) : data ? (
          <div className="space-y-4">
            {data.weeklyComparison && (
              <div className={isMobile ? "grid grid-cols-2 gap-3" : "grid grid-cols-4 gap-4"}>
                <Card className="border-t-4 border-t-blue-500">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Hours This Week</p>
                    <p className="text-2xl font-bold mt-1">{data.weeklyComparison.thisWeek.hours.toFixed(1)}h</p>
                    <ComparisonIndicator current={data.weeklyComparison.thisWeek.hours} previous={data.weeklyComparison.lastWeek.hours} format="hours" />
                  </CardContent>
                </Card>
                <Card className="border-t-4 border-t-green-500">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Labor Cost This Week</p>
                    <p className="text-2xl font-bold mt-1">${data.weeklyComparison.thisWeek.cost.toFixed(0)}</p>
                    <ComparisonIndicator current={data.weeklyComparison.thisWeek.cost} previous={data.weeklyComparison.lastWeek.cost} format="currency" />
                  </CardContent>
                </Card>
                <Card className="border-t-4 border-t-purple-500">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Tasks Completed</p>
                    <p className="text-2xl font-bold mt-1">{data.weeklyComparison.thisWeek.tasksCompleted}</p>
                    <ComparisonIndicator current={data.weeklyComparison.thisWeek.tasksCompleted} previous={data.weeklyComparison.lastWeek.tasksCompleted} />
                  </CardContent>
                </Card>
                <Card className="border-t-4 border-t-amber-500">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Punctuality</p>
                    <p className={`text-2xl font-bold mt-1 ${punctualityColor(data.punctualityScore.percentage)}`}>{data.punctualityScore.percentage}%</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{data.punctualityScore.onTime} on time / {data.punctualityScore.late} late</p>
                  </CardContent>
                </Card>
              </div>
            )}

            <div className={isMobile ? "grid grid-cols-2 gap-3" : "grid grid-cols-4 gap-4"}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                      <i className="fas fa-user-check text-green-600 dark:text-green-400"></i>
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold">{data.teamSummary.activeNow}</p>
                      <p className="text-xs text-muted-foreground truncate">Active Now</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <i className="fas fa-users text-blue-600 dark:text-blue-400"></i>
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold">{data.teamSummary.totalEmployees}</p>
                      <p className="text-xs text-muted-foreground truncate">Total Employees</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                      <i className="fas fa-clock text-amber-600 dark:text-amber-400"></i>
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold">{data.teamSummary.totalHoursToday.toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground truncate">Hours Today</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                      <i className="fas fa-check-circle text-purple-600 dark:text-purple-400"></i>
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold">{data.teamSummary.tasksCompletedToday}</p>
                      <p className="text-xs text-muted-foreground truncate">Tasks Done Today</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-4"}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-dollar-sign text-primary"></i>
                    Labor Cost Trends (30 Days)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.laborCostByDay.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={data.laborCostByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          tick={{ fontSize: 11 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            name === 'totalCost' ? `$${value.toFixed(2)}` : `${value.toFixed(1)}h`,
                            name === 'totalCost' ? 'Cost' : 'Hours',
                          ]}
                          labelFormatter={formatDate}
                        />
                        <Bar dataKey="totalCost" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-12">
                      <i className="fas fa-chart-bar text-muted-foreground text-3xl mb-3"></i>
                      <p className="text-sm text-muted-foreground">No labor cost data available yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-bullseye text-primary"></i>
                    Punctuality Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center py-4">
                    <div className="relative w-36 h-36 mb-4">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="50" fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
                        <circle
                          cx="60" cy="60" r="50" fill="none"
                          stroke="hsl(var(--primary))"
                          strokeWidth="10"
                          strokeLinecap="round"
                          strokeDasharray={`${(data.punctualityScore.percentage / 100) * 314} 314`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-2xl font-bold ${punctualityColor(data.punctualityScore.percentage)}`}>
                          {data.punctualityScore.percentage}%
                        </span>
                        <span className="text-xs text-muted-foreground">On Time</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 w-full text-center">
                      <div>
                        <p className="text-lg font-semibold text-green-600 dark:text-green-400">{data.punctualityScore.onTime}</p>
                        <p className="text-xs text-muted-foreground">On Time</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-red-600 dark:text-red-400">{data.punctualityScore.late}</p>
                        <p className="text-xs text-muted-foreground">Late</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold">{data.punctualityScore.total}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-tasks text-primary"></i>
                    Task Completion (This Week)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 py-4">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-3xl font-bold">{data.taskCompletion.percentage}%</p>
                        <p className="text-sm text-muted-foreground">
                          {data.taskCompletion.completed} of {data.taskCompletion.total} tasks completed
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {data.taskCompletion.total - data.taskCompletion.completed} remaining
                        </p>
                      </div>
                    </div>
                    <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${data.taskCompletion.percentage}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-green-50 dark:bg-green-900/10 rounded-lg">
                        <p className="font-semibold text-green-600 dark:text-green-400">{data.taskCompletion.completed}</p>
                        <p className="text-xs text-muted-foreground">Done</p>
                      </div>
                      <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-900/10 rounded-lg">
                        <p className="font-semibold text-yellow-600 dark:text-yellow-400">
                          {data.taskCompletion.total - data.taskCompletion.completed}
                        </p>
                        <p className="text-xs text-muted-foreground">Pending</p>
                      </div>
                      <div className="text-center p-2 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
                        <p className="font-semibold text-blue-600 dark:text-blue-400">{data.taskCompletion.total}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-chart-line text-primary"></i>
                    Hours by Day (30 Days)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.laborCostByDay.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={data.laborCostByDay}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          tick={{ fontSize: 11 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                        <Tooltip
                          formatter={(value: number) => [`${value.toFixed(1)}h`, 'Hours']}
                          labelFormatter={formatDate}
                        />
                        <Bar dataKey="totalHours" fill="hsl(var(--chart-2, 200 80% 50%))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-12">
                      <i className="fas fa-chart-line text-muted-foreground text-3xl mb-3"></i>
                      <p className="text-sm text-muted-foreground">No hours data available yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {data.employeePunctualityBreakdown && data.employeePunctualityBreakdown.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-user-clock text-primary"></i>
                    Employee Punctuality Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead className="text-center">On Time</TableHead>
                          <TableHead className="text-center">Late</TableHead>
                          <TableHead className="text-center">Total</TableHead>
                          <TableHead className="text-center">Score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.employeePunctualityBreakdown.map((emp) => (
                          <TableRow key={emp.userId}>
                            <TableCell className="font-medium">{emp.name}</TableCell>
                            <TableCell className="text-center text-green-600 dark:text-green-400">{emp.onTime}</TableCell>
                            <TableCell className="text-center text-red-600 dark:text-red-400">{emp.late}</TableCell>
                            <TableCell className="text-center">{emp.total}</TableCell>
                            <TableCell className="text-center">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${punctualityBg(emp.percentage)} ${punctualityColor(emp.percentage)}`}>
                                {emp.percentage}%
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {connectedShop?.shopDomain && data.weeklyComparison && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fas fa-balance-scale text-primary"></i>
                    Labor Cost vs Revenue
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-lg text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Weekly Labor Cost</p>
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                        ${data.weeklyComparison.thisWeek.cost.toFixed(0)}
                      </p>
                    </div>
                    <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-lg text-center">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Shopify Revenue</p>
                      <p className="text-sm text-muted-foreground mt-2">View in Shopify Analytics below</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <i className="fas fa-exclamation-triangle text-muted-foreground text-3xl mb-3"></i>
            <p className="text-sm text-muted-foreground">Unable to load analytics data</p>
          </div>
        )}

        {connectedShop?.shopDomain && (
          <div className="mt-4">
            <ShopifyAnalytics shopDomain={connectedShop.shopDomain} />
          </div>
        )}

        <Card className="mt-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <i className="fas fa-shield-alt text-primary"></i>
                AI Anomaly Detection
              </CardTitle>
              <Button
                size="sm"
                onClick={() => anomalyScan.mutate()}
                disabled={anomalyScan.isPending}
              >
                {anomalyScan.isPending ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Scanning...
                  </>
                ) : (
                  <>
                    <i className="fas fa-search mr-2"></i>
                    Run Anomaly Scan
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {anomalyScan.isPending && (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            )}

            {anomalyScan.isError && (
              <div className="text-center py-6">
                <i className="fas fa-exclamation-circle text-red-500 text-2xl mb-2"></i>
                <p className="text-sm text-muted-foreground">Failed to run anomaly scan. Please try again.</p>
              </div>
            )}

            {anomalyScan.data && anomalyScan.data.anomalies.length > 0 ? (
              <div className="space-y-3">
                {anomalyScan.data.anomalies.map((anomaly, index) => (
                  <Card key={index} className={`${severityBorder(anomaly.severity)}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{anomaly.type}</span>
                            {severityBadge(anomaly.severity)}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{anomaly.description}</p>
                          <div className="flex items-start gap-1.5">
                            <i className="fas fa-lightbulb text-yellow-500 mt-0.5 text-xs"></i>
                            <p className="text-xs text-muted-foreground">{anomaly.recommendation}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : anomalyScan.data && anomalyScan.data.anomalies.length === 0 ? (
              <div className="text-center py-6">
                <i className="fas fa-check-circle text-green-500 text-2xl mb-2"></i>
                <p className="text-sm text-muted-foreground">No anomalies detected. Everything looks good!</p>
              </div>
            ) : !anomalyScan.isPending && !anomalyScan.isError ? (
              <div className="text-center py-6">
                <i className="fas fa-robot text-muted-foreground text-2xl mb-2"></i>
                <p className="text-sm text-muted-foreground">Click "Run Anomaly Scan" to analyze time entries for unusual patterns</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <TeamScoresSection />

        <GamificationSettingsPanel />
      </div>
    </div>
  );
}