import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface AIStaffingPanelProps {
  shopDomain: string;
}

interface StaffingDay {
  date: string;
  dayName: string;
  dayOfWeek: number;
  lastYearRevenue: number | null;
  lastYearOrders: number | null;
  avgDowRevenue: number;
  avgDowOrders: number;
  dataSamples: number;
  recommendedStaff: number | null;
  staffingLevel: string | null;
  reason: string | null;
}

interface AIStaffingData {
  days: StaffingDay[];
  aiSummary: string;
  teamSize: number;
  dateRange: { startDate: string; endDate: string };
  dataAvailability: { previousYearDays: number; historicalDays: number };
}

interface YoYData {
  currentYear: {
    days: { date: string; dayName: string; revenue: number; orders: number }[];
    totalRevenue: number;
    totalOrders: number;
    avgDailyRevenue: number;
  };
  previousYear: {
    days: { date: string; dayName: string; revenue: number; orders: number }[];
    totalRevenue: number;
    totalOrders: number;
    avgDailyRevenue: number;
  };
  trends: {
    revenueGrowthPercent: number | null;
    orderGrowthPercent: number | null;
    hasPreviousData: boolean;
  };
}

const levelColors: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-300",
  above_average: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300",
  normal: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300 border-gray-300",
  below_average: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300",
  low: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-300",
};

const levelLabels: Record<string, string> = {
  high: "Busy",
  above_average: "Above Avg",
  normal: "Normal",
  below_average: "Below Avg",
  low: "Quiet",
};

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AIStaffingPanel({ shopDomain }: AIStaffingPanelProps) {
  const today = new Date();
  const nextWeekStart = new Date(today);
  nextWeekStart.setDate(today.getDate() + (7 - today.getDay()));
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  const [startDate, setStartDate] = useState(nextWeekStart.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(nextWeekEnd.toISOString().split("T")[0]);
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: staffingData, isLoading: staffingLoading, isError: staffingError } = useQuery<AIStaffingData>({
    queryKey: ["/api/shopify/ai-staffing", shopDomain, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/shopify/ai-staffing?shop=${encodeURIComponent(shopDomain)}&startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!shopDomain && !!startDate && !!endDate && isExpanded,
  });

  const { data: yoyData, isLoading: yoyLoading } = useQuery<YoYData>({
    queryKey: ["/api/shopify/yoy-comparison", shopDomain, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/shopify/yoy-comparison?shop=${encodeURIComponent(shopDomain)}&startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!shopDomain && !!startDate && !!endDate && isExpanded,
  });

  const chartData = useMemo(() => {
    if (!yoyData?.previousYear?.days) return [];
    const prevMap = new Map(yoyData.previousYear.days.map((d) => [d.dayName, d]));

    const days: string[] = [];
    const cursor = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    while (cursor <= end) {
      const dayName = dayNames[cursor.getUTCDay()];
      const dateStr = cursor.toISOString().split("T")[0];
      const prevDay = prevMap.get(dayName);
      const currentDay = yoyData.currentYear?.days?.find((d) => d.date === dateStr);

      days.push(dateStr);
      cursor.setDate(cursor.getDate() + 1);
    }

    return days.map((dateStr) => {
      const d = new Date(dateStr + "T00:00:00");
      const dayName = dayNames[d.getUTCDay()];
      const prevDay = yoyData.previousYear.days.find(
        (p) => p.dayName === dayName
      );
      const currentDay = yoyData.currentYear.days.find(
        (c) => c.date === dateStr
      );

      return {
        name: `${dayName.slice(0, 3)} ${formatDateShort(dateStr)}`,
        "Last Year": prevDay?.revenue || 0,
        "This Year": currentDay?.revenue || 0,
      };
    });
  }, [yoyData, startDate, endDate]);

  const isLoading = staffingLoading || yoyLoading;

  if (!isExpanded) {
    return (
      <Card>
        <CardContent className="p-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setIsExpanded(true)}
          >
            <i className="fas fa-brain mr-2"></i>
            AI Sales-Based Staffing
            <i className="fas fa-chevron-down ml-auto"></i>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-brain text-primary"></i>
            AI Sales-Based Staffing
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setIsExpanded(false)}>
            <i className="fas fa-chevron-up"></i>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground uppercase">From</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground uppercase">To</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {staffingError && (
          <div className="text-sm text-red-500 p-3 bg-red-50 dark:bg-red-900/20 rounded-md">
            <i className="fas fa-exclamation-circle mr-1"></i>
            Unable to load staffing data. Make sure your Shopify store is synced.
          </div>
        )}

        {!isLoading && staffingData && (
          <>
            {staffingData.aiSummary && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                <i className="fas fa-robot mr-1 text-primary"></i>
                {staffingData.aiSummary}
              </div>
            )}

            {staffingData.dataAvailability.previousYearDays === 0 &&
              staffingData.dataAvailability.historicalDays === 0 && (
                <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-md">
                  <i className="fas fa-info-circle mr-1"></i>
                  No historical sales data found. Sync your Shopify store to get AI staffing recommendations.
                </div>
              )}

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Recommended Staff Per Day
              </p>
              <div className="grid grid-cols-1 gap-2">
                {staffingData.days.map((day) => (
                  <div
                    key={day.date}
                    className={`flex items-center justify-between p-2.5 rounded-md border ${
                      levelColors[day.staffingLevel || "normal"]
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-xs font-semibold">{day.dayName}</p>
                        <p className="text-[10px] opacity-75">{formatDateShort(day.date)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {day.lastYearRevenue !== null && (
                        <div className="text-right">
                          <p className="text-[10px] opacity-60">Last yr</p>
                          <p className="text-[11px] font-medium">${Math.round(day.lastYearRevenue)}</p>
                        </div>
                      )}
                      <div className="text-right">
                        <p className="text-[10px] opacity-60">Avg {day.dayName.slice(0, 3)}</p>
                        <p className="text-[11px] font-medium">${day.avgDowRevenue}</p>
                      </div>
                      <div className="text-center min-w-[50px]">
                        {day.recommendedStaff !== null ? (
                          <>
                            <p className="text-lg font-bold leading-none">{day.recommendedStaff}</p>
                            <p className="text-[9px] opacity-60">staff</p>
                          </>
                        ) : (
                          <p className="text-xs opacity-50">--</p>
                        )}
                      </div>
                      {day.staffingLevel && (
                        <Badge variant="outline" className="text-[9px] min-w-[60px] justify-center">
                          {levelLabels[day.staffingLevel] || day.staffingLevel}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {staffingData.days.some((d) => d.reason) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  <i className="fas fa-info-circle mr-1"></i>
                  View AI reasoning
                </summary>
                <div className="mt-2 space-y-1 pl-4">
                  {staffingData.days
                    .filter((d) => d.reason)
                    .map((d) => (
                      <p key={d.date} className="text-muted-foreground">
                        <strong>{d.dayName}:</strong> {d.reason}
                      </p>
                    ))}
                </div>
              </details>
            )}
          </>
        )}

        {!isLoading && yoyData && chartData.length > 0 && yoyData.trends.hasPreviousData && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Year-over-Year Sales
              </p>
              {yoyData.trends.revenueGrowthPercent !== null && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    yoyData.trends.revenueGrowthPercent >= 0
                      ? "text-green-600 border-green-300"
                      : "text-red-600 border-red-300"
                  }`}
                >
                  {yoyData.trends.revenueGrowthPercent >= 0 ? "+" : ""}
                  {yoyData.trends.revenueGrowthPercent}% revenue
                </Badge>
              )}
            </div>

            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(2)}`, undefined]}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Last Year" fill="#94a3b8" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="This Year" fill="#6c63ff" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-2 bg-muted/30 rounded-md">
                <p className="text-[10px] text-muted-foreground">Last Year Total</p>
                <p className="text-sm font-bold">${yoyData.previousYear.totalRevenue.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{yoyData.previousYear.totalOrders} orders</p>
              </div>
              <div className="p-2 bg-muted/30 rounded-md">
                <p className="text-[10px] text-muted-foreground">This Year Total</p>
                <p className="text-sm font-bold">${yoyData.currentYear.totalRevenue.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{yoyData.currentYear.totalOrders} orders</p>
              </div>
            </div>
          </div>
        )}

        {staffingData && (
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t">
            <span>Team: {staffingData.teamSize} employees</span>
            <span>
              {staffingData.dataAvailability.historicalDays} days of sales history
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
