import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { AlertTriangle, DollarSign, Activity, Zap, TrendingUp, Trash2 } from "lucide-react";

interface Summary {
  period: { start: string; daysElapsed: number; totalDaysInMonth: number };
  totals: {
    mtdSpend: number;
    projectedSpend: number;
    totalCalls: number;
    totalSuccess: number;
    totalErrors: number;
    totalBlocked: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  backgroundVsUser: { backgroundSpend: number; userSpend: number };
  byFeature: { feature: string; spend: number; calls: number }[];
  byModel: { model: string; provider: string; spend: number; calls: number; inputTokens: number; outputTokens: number }[];
  byStore: { storeId: string | null; spend: number; calls: number }[];
  budgets: {
    id: string;
    scope: string;
    storeId: string | null;
    monthlyLimitUsd: number;
    alertThresholdPercent: number;
    hardBlock: boolean;
    enabled: boolean;
  }[];
}

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
const fmtInt = (n: number) => n.toLocaleString();

export default function AiSpend() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const summaryQ = useQuery<{ success: boolean; data: Summary }>({
    queryKey: ["/api/ai-spend/summary"],
    refetchInterval: 30_000,
  });
  const seriesQ = useQuery<{ success: boolean; data: { day: string; provider: string; spend: number; calls: number }[] }>({
    queryKey: ["/api/ai-spend/timeseries?days=30"],
  });
  const eventsQ = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/ai-spend/events?limit=50"],
  });

  const summary = summaryQ.data?.data;

  // Budget editor local state
  const [globalLimit, setGlobalLimit] = useState("");
  const [globalThreshold, setGlobalThreshold] = useState("80");
  const [globalHardBlock, setGlobalHardBlock] = useState(true);

  const upsertBudget = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/ai-spend/budgets", body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-spend/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/ai-spend/budgets"] });
      toast({ title: "Budget saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save budget", description: e?.message, variant: "destructive" }),
  });

  const deleteBudget = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/ai-spend/budgets/${id}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-spend/summary"] });
      toast({ title: "Budget deleted" });
    },
  });

  const globalBudget = summary?.budgets.find((b) => b.scope === "global");

  const renderKpi = (icon: any, label: string, value: string, sub?: string, accent?: string) => {
    const Icon = icon;
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
              <div className={`text-2xl font-semibold mt-1 ${accent ?? ""}`}>{value}</div>
              {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
            </div>
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  };

  const budgetUsedPct = globalBudget && globalBudget.monthlyLimitUsd > 0 && summary
    ? Math.round((summary.totals.mtdSpend / globalBudget.monthlyLimitUsd) * 100)
    : 0;

  return (
    <div className="container max-w-7xl mx-auto p-4 space-y-4" data-testid="page-ai-spend">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI Spend</h1>
          <p className="text-sm text-muted-foreground">
            Live tracking of every AI call: cost, usage, budgets, alerts.
          </p>
        </div>
      </div>

      {summaryQ.isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {summary && (
        <>
          {globalBudget && budgetUsedPct >= 80 && (
            <Card className={`border-2 ${budgetUsedPct >= 100 ? "border-red-500 bg-red-50 dark:bg-red-950/30" : "border-amber-500 bg-amber-50 dark:bg-amber-950/30"}`}>
              <CardContent className="pt-6 flex items-start gap-3">
                <AlertTriangle className={`h-5 w-5 ${budgetUsedPct >= 100 ? "text-red-600" : "text-amber-600"}`} />
                <div>
                  <div className="font-semibold">
                    {budgetUsedPct >= 100
                      ? "Global AI budget reached — new AI calls are being blocked"
                      : `Global AI budget at ${budgetUsedPct}% — alert threshold crossed`}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {fmtUsd(summary.totals.mtdSpend)} of {fmtUsd(globalBudget.monthlyLimitUsd)} this month.
                    {budgetUsedPct >= 100 && globalBudget.hardBlock
                      ? " Raise the limit below to resume AI calls."
                      : " Calls continue running until 100% is reached."}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {renderKpi(DollarSign, "MTD spend", fmtUsd(summary.totals.mtdSpend),
              `Day ${summary.period.daysElapsed} of ${summary.period.totalDaysInMonth}`)}
            {renderKpi(TrendingUp, "Projected month", fmtUsd(summary.totals.projectedSpend),
              globalBudget ? `Budget: ${fmtUsd(globalBudget.monthlyLimitUsd)}` : "No global budget",
              globalBudget && summary.totals.projectedSpend > globalBudget.monthlyLimitUsd ? "text-red-600" : "")}
            {renderKpi(Activity, "Total calls", fmtInt(summary.totals.totalCalls),
              `${fmtInt(summary.totals.totalErrors)} errors · ${fmtInt(summary.totals.totalBlocked)} blocked`)}
            {renderKpi(Zap, "Tokens used",
              fmtInt(summary.totals.totalInputTokens + summary.totals.totalOutputTokens),
              `${fmtInt(summary.totals.totalInputTokens)} in · ${fmtInt(summary.totals.totalOutputTokens)} out`)}
          </div>

          <Tabs defaultValue="breakdown">
            <TabsList>
              <TabsTrigger value="breakdown" data-testid="tab-breakdown">Breakdown</TabsTrigger>
              <TabsTrigger value="events" data-testid="tab-events">Recent calls</TabsTrigger>
              <TabsTrigger value="budgets" data-testid="tab-budgets">Budgets</TabsTrigger>
              <TabsTrigger value="timeseries" data-testid="tab-timeseries">Daily trend</TabsTrigger>
            </TabsList>

            <TabsContent value="breakdown" className="space-y-4 mt-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">By feature</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Feature</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Calls</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.byFeature.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No data yet</TableCell></TableRow>}
                        {summary.byFeature.map((r) => (
                          <TableRow key={r.feature}><TableCell>{r.feature}</TableCell><TableCell className="text-right font-mono">{fmtUsd(r.spend)}</TableCell><TableCell className="text-right">{fmtInt(r.calls)}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">By model</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Model</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Calls</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.byModel.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No data yet</TableCell></TableRow>}
                        {summary.byModel.map((r) => (
                          <TableRow key={`${r.provider}-${r.model}`}>
                            <TableCell>
                              <div className="text-sm">{r.model}</div>
                              <div className="text-xs text-muted-foreground">{r.provider}</div>
                            </TableCell>
                            <TableCell className="text-right font-mono">{fmtUsd(r.spend)}</TableCell>
                            <TableCell className="text-right">{fmtInt(r.calls)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-base">Background vs user-triggered</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-xs text-muted-foreground">Background jobs</div>
                    <div className="text-2xl font-semibold mt-1">{fmtUsd(summary.backgroundVsUser.backgroundSpend)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">User-triggered</div>
                    <div className="text-2xl font-semibold mt-1">{fmtUsd(summary.backgroundVsUser.userSpend)}</div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="events" className="mt-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Last 50 AI calls</CardTitle></CardHeader>
                <CardContent>
                  {eventsQ.isLoading ? <Skeleton className="h-40" /> : (
                    <div className="overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>When</TableHead>
                            <TableHead>Feature</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead>Op</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                            <TableHead className="text-right">Tokens</TableHead>
                            <TableHead className="text-right">Latency</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(eventsQ.data?.data ?? []).map((e: any) => (
                            <TableRow key={e.id}>
                              <TableCell className="text-xs whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</TableCell>
                              <TableCell className="text-xs">{e.feature}</TableCell>
                              <TableCell className="text-xs font-mono">{e.model}</TableCell>
                              <TableCell className="text-xs">{e.operation}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{fmtUsd(Number(e.costUsd))}</TableCell>
                              <TableCell className="text-right text-xs">{fmtInt((e.inputTokens ?? 0) + (e.outputTokens ?? 0))}</TableCell>
                              <TableCell className="text-right text-xs">{e.latencyMs ?? "—"}ms</TableCell>
                              <TableCell>
                                <Badge variant={e.status === "success" ? "secondary" : "destructive"} className="text-xs">{e.status}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="budgets" className="mt-4 space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Global monthly budget</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="global-limit">Monthly limit (USD)</Label>
                      <Input id="global-limit" type="number" min="0" step="1"
                        placeholder={globalBudget ? String(globalBudget.monthlyLimitUsd) : "e.g. 500"}
                        value={globalLimit}
                        onChange={(e) => setGlobalLimit(e.target.value)}
                        data-testid="input-global-limit" />
                    </div>
                    <div>
                      <Label htmlFor="global-threshold">Alert at (%)</Label>
                      <Input id="global-threshold" type="number" min="1" max="99" step="1"
                        value={globalThreshold}
                        onChange={(e) => setGlobalThreshold(e.target.value)}
                        data-testid="input-global-threshold" />
                    </div>
                    <div className="flex items-end gap-2">
                      <Switch checked={globalHardBlock} onCheckedChange={setGlobalHardBlock} id="global-hard" data-testid="switch-global-hardblock" />
                      <Label htmlFor="global-hard">Hard-block at 100%</Label>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      const limit = Number(globalLimit || globalBudget?.monthlyLimitUsd || 0);
                      const threshold = Math.min(99, Math.max(1, Number(globalThreshold) || 80));
                      upsertBudget.mutate({
                        scope: "global",
                        storeId: null,
                        monthlyLimitUsd: limit,
                        alertThresholdPercent: threshold,
                        hardBlock: globalHardBlock,
                        enabled: true,
                      });
                    }}
                    disabled={upsertBudget.isPending}
                    data-testid="button-save-global-budget"
                  >
                    {globalBudget ? "Update global budget" : "Set global budget"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">All budgets</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Scope</TableHead>
                        <TableHead>Store</TableHead>
                        <TableHead className="text-right">Limit</TableHead>
                        <TableHead className="text-right">Alert at</TableHead>
                        <TableHead>Hard block</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.budgets.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No budgets configured</TableCell></TableRow>}
                      {summary.budgets.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell><Badge variant="outline">{b.scope}</Badge></TableCell>
                          <TableCell className="text-xs font-mono">{b.storeId ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{fmtUsd(b.monthlyLimitUsd)}</TableCell>
                          <TableCell className="text-right">{b.alertThresholdPercent}%</TableCell>
                          <TableCell>{b.hardBlock ? "Yes" : "No"}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => deleteBudget.mutate(b.id)} data-testid={`button-delete-budget-${b.id}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="timeseries" className="mt-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Daily spend (last 30 days)</CardTitle></CardHeader>
                <CardContent>
                  {seriesQ.isLoading ? <Skeleton className="h-40" /> : (
                    <Table>
                      <TableHeader><TableRow><TableHead>Day</TableHead><TableHead>Provider</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Calls</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {(seriesQ.data?.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No data yet</TableCell></TableRow>}
                        {(seriesQ.data?.data ?? []).slice().reverse().map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{r.day}</TableCell>
                            <TableCell className="text-sm">{r.provider}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{fmtUsd(r.spend)}</TableCell>
                            <TableCell className="text-right text-sm">{fmtInt(r.calls)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
