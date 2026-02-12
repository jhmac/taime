import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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

export default function ShopifyAnalytics({ shopDomain }: { shopDomain: string }) {
  const { data, isLoading } = useQuery<LaborCostRatioData>({
    queryKey: ['/api/shopify/labor-cost-ratio', shopDomain],
    queryFn: async () => {
      const res = await fetch(`/api/shopify/labor-cost-ratio?shop=${encodeURIComponent(shopDomain)}&daysBack=30`, { credentials: 'include' });
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

  const chartData = data.dailyBreakdown.map(d => ({
    date: d.date,
    revenue: d.revenue,
    laborCost: d.laborCost,
    percentage: d.percentage,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <i className="fab fa-shopify text-green-600 text-lg"></i>
        <h2 className="text-base font-semibold">Shopify Revenue vs Labor Cost</h2>
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
            Revenue vs Labor Cost (30 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
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
                    `$${value.toFixed(2)}`,
                    name === 'revenue' ? 'Revenue' : 'Labor Cost',
                  ]}
                  labelFormatter={formatDate}
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

      {data.dailyBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-table text-primary"></i>
              Daily Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Labor Cost</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Labor %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyBreakdown.slice().reverse().slice(0, 14).map((day) => (
                    <tr key={day.date} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 px-2">{formatDate(day.date)}</td>
                      <td className="text-right py-2 px-2">${day.revenue.toLocaleString()}</td>
                      <td className="text-right py-2 px-2">${day.laborCost.toLocaleString()}</td>
                      <td className={`text-right py-2 px-2 font-medium ${getPercentageColor(day.percentage)}`}>
                        {day.percentage}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
