import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import CashCountingWizard from "@/components/cash/CashCountingWizard";
import DepositFlow from "@/components/cash/DepositFlow";
import { useLocation } from "wouter";

type ViewMode = "main" | "wizard" | "deposit" | "investigation";

export default function CashManagement() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [activeSession, setActiveSession] = useState<{ id: string; type: "opening" | "closing"; registerName: string; startingCash: number } | null>(null);
  const [ownerTab, setOwnerTab] = useState("daily");

  const { data: accessCheck, isLoading: accessLoading } = useQuery({
    queryKey: ["/api/cash/access-check"],
    refetchInterval: 30000,
  });
  const { data: settings, isLoading: settingsLoading } = useQuery({ queryKey: ["/api/cash/settings"], enabled: accessCheck?.allowed });
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({ queryKey: ["/api/cash/sessions", selectedDate], enabled: accessCheck?.allowed, queryFn: async () => {
    const res = await apiRequest("GET", `/api/cash/sessions?date=${selectedDate}`);
    return res.json();
  }});
  const { data: deposits = [], isLoading: depositsLoading } = useQuery({ queryKey: ["/api/cash/deposits", selectedDate], enabled: accessCheck?.allowed, queryFn: async () => {
    const res = await apiRequest("GET", `/api/cash/deposits?date=${selectedDate}`);
    return res.json();
  }});

  const createSessionMutation = useMutation({
    mutationFn: async (data: { sessionType: string; registerName: string; startingCash: string }) => {
      const res = await apiRequest("POST", "/api/cash/sessions", data);
      return res.json();
    },
    onSuccess: (session: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      setActiveSession({
        id: session.id,
        type: session.sessionType,
        registerName: session.registerName,
        startingCash: parseFloat(session.startingCash || "200"),
      });
      setViewMode("wizard");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await apiRequest("PUT", `/api/cash/sessions/${sessionId}/verify`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      toast({ title: "Verified", description: "Session verified successfully." });
    },
  });

  const registers = (settings?.registers as any[]) || [{ name: "Register 1", id: "register-1" }];

  if (accessLoading) {
    return (
      <div className="p-4 max-w-4xl mx-auto mt-12">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-32 w-full max-w-md" />
        </div>
      </div>
    );
  }

  if (accessCheck && !accessCheck.allowed) {
    const notClockedIn = !accessCheck.clockedIn;
    const notAtStore = accessCheck.clockedIn && !accessCheck.atStore;
    return (
      <div className="p-4 max-w-md mx-auto mt-12">
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
              <i className={`fas ${notAtStore ? "fa-map-marker-alt" : "fa-clock"} text-2xl text-amber-600 dark:text-amber-400`} />
            </div>
            <h2 className="text-xl font-bold text-amber-900 dark:text-amber-100">
              {notAtStore ? "Not at Store Location" : "Clock In Required"}
            </h2>
            <p className="text-amber-700 dark:text-amber-300 text-sm">
              {notAtStore
                ? "You're clocked in but not at the store location. Cash Management is only available when you're physically at the store."
                : "You need to be clocked in and at the store to access Cash Management. Please clock in first, then come back here."}
            </p>
            <div className="pt-2 space-y-2">
              <Button onClick={() => navigate("/")} className="w-full">
                <i className="fas fa-home mr-2" /> Go to Dashboard
              </Button>
              <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/cash/access-check"] })} className="w-full">
                <i className="fas fa-sync mr-2" /> Check Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (viewMode === "wizard" && activeSession) {
    return (
      <div className="h-[calc(100vh-4rem)]">
        <CashCountingWizard
          sessionId={activeSession.id}
          sessionType={activeSession.type}
          registerName={activeSession.registerName}
          startingCash={activeSession.startingCash}
          onComplete={() => { setViewMode("main"); setActiveSession(null); }}
          onCancel={() => { setViewMode("main"); setActiveSession(null); }}
        />
      </div>
    );
  }

  if (viewMode === "deposit") {
    return (
      <div className="h-[calc(100vh-4rem)]">
        <DepositFlow
          sessions={sessions.filter((s: any) => s.sessionType === "closing" && (s.status === "counted" || s.status === "verified"))}
          onComplete={() => setViewMode("main")}
          onCancel={() => setViewMode("main")}
        />
      </div>
    );
  }

  const openingSessions = sessions.filter((s: any) => s.sessionType === "opening");
  const closingSessions = sessions.filter((s: any) => s.sessionType === "closing");
  const hasDeposit = deposits.length > 0;

  const getRegisterStatus = (regName: string) => {
    const opening = openingSessions.find((s: any) => s.registerName === regName);
    const closing = closingSessions.find((s: any) => s.registerName === regName);
    return { opening, closing };
  };

  const totalOverShort = sessions
    .filter((s: any) => s.overShortAmount)
    .reduce((sum: number, s: any) => sum + parseFloat(s.overShortAmount), 0);

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <i className="fas fa-cash-register text-primary" /> Cash
          </h1>
          <p className="text-muted-foreground text-sm">
            {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-auto"
        />
      </div>

      {(settingsLoading || sessionsLoading) ? (
        <div className="space-y-3">
          <Skeleton className="h-32" /><Skeleton className="h-32" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Opened</p>
              <p className="text-lg font-bold">{openingSessions.filter((s: any) => s.status !== "pending").length}/{registers.length}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Closed</p>
              <p className="text-lg font-bold">{closingSessions.filter((s: any) => s.status !== "pending").length}/{registers.length}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Deposit</p>
              <p className="text-lg font-bold">{hasDeposit ? <i className="fas fa-check text-green-500" /> : "Pending"}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Over/Short</p>
              <p className={cn("text-lg font-bold", totalOverShort === 0 ? "text-green-600" : totalOverShort < 0 ? "text-red-600" : "text-yellow-600")}>
                {totalOverShort === 0 ? "$0.00" : totalOverShort > 0 ? `+$${totalOverShort.toFixed(2)}` : `-$${Math.abs(totalOverShort).toFixed(2)}`}
              </p>
            </CardContent></Card>
          </div>

          <div className="space-y-3">
            {registers.map((reg: any) => {
              const { opening, closing } = getRegisterStatus(reg.name);
              return (
                <Card key={reg.name}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold flex items-center gap-2">
                        <i className="fas fa-tablet-alt text-muted-foreground" />
                        {reg.name}
                      </h3>
                      {opening && opening.status !== "pending" && closing && closing.status !== "pending" ? (
                        <Badge variant="default" className="bg-green-500">Complete</Badge>
                      ) : (
                        <Badge variant="secondary">In Progress</Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground font-medium">Opening</p>
                        {opening && opening.status !== "pending" ? (
                          <div className="text-sm">
                            <p className="font-medium text-green-600">
                              <i className="fas fa-check-circle mr-1" />
                              ${parseFloat(opening.totalCashCounted || "0").toFixed(2)}
                            </p>
                            {opening.overShortAmount && Math.abs(parseFloat(opening.overShortAmount)) >= 0.01 && (
                              <p className={cn("text-xs", parseFloat(opening.overShortAmount) < 0 ? "text-red-500" : "text-yellow-500")}>
                                {parseFloat(opening.overShortAmount) > 0 ? "+" : ""}${parseFloat(opening.overShortAmount).toFixed(2)}
                              </p>
                            )}
                            {isAdmin && opening.status === "counted" && (
                              <Button variant="ghost" size="sm" className="text-xs h-6 px-2 mt-1" onClick={() => verifyMutation.mutate(opening.id)}>
                                <i className="fas fa-check mr-1" /> Verify
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full h-10"
                            onClick={() => createSessionMutation.mutate({
                              sessionType: "opening", registerName: reg.name,
                              startingCash: settings?.defaultStartingCash || "200.00",
                            })}
                            disabled={createSessionMutation.isPending || selectedDate !== today}>
                            <i className="fas fa-door-open mr-1" /> Open Drawer
                          </Button>
                        )}
                      </div>

                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground font-medium">Closing</p>
                        {closing && closing.status !== "pending" ? (
                          <div className="text-sm">
                            <p className="font-medium text-green-600">
                              <i className="fas fa-check-circle mr-1" />
                              ${parseFloat(closing.totalCashCounted || "0").toFixed(2)}
                            </p>
                            {closing.overShortAmount && Math.abs(parseFloat(closing.overShortAmount)) >= 0.01 && (
                              <p className={cn("text-xs", parseFloat(closing.overShortAmount) < 0 ? "text-red-500" : "text-yellow-500")}>
                                {parseFloat(closing.overShortAmount) > 0 ? "+" : ""}${parseFloat(closing.overShortAmount).toFixed(2)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full h-10"
                            onClick={() => createSessionMutation.mutate({
                              sessionType: "closing", registerName: reg.name,
                              startingCash: settings?.defaultStartingCash || "200.00",
                            })}
                            disabled={createSessionMutation.isPending || selectedDate !== today || !opening || opening.status === "pending"}>
                            <i className="fas fa-door-closed mr-1" /> Close Drawer
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {closingSessions.some((s: any) => s.status === "counted" || s.status === "verified") && !hasDeposit && selectedDate === today && (
            <Button className="w-full h-12 gap-2" onClick={() => setViewMode("deposit")}>
              <i className="fas fa-university" /> Make Bank Deposit
            </Button>
          )}

          {deposits.map((dep: any) => (
            <Card key={dep.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold flex items-center gap-2">
                    <i className="fas fa-university text-blue-500" /> Bank Deposit
                  </h3>
                  <Badge variant={dep.status === "approved" ? "default" : dep.status === "flagged" ? "destructive" : "secondary"}>
                    {dep.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Expected</p>
                    <p className="font-medium">${parseFloat(dep.expectedAmount || "0").toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Actual</p>
                    <p className="font-medium">${parseFloat(dep.actualAmount || "0").toFixed(2)}</p>
                  </div>
                  {dep.aiConfidence && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground">AI Verification</p>
                      <p className="text-sm">{dep.aiAnalysis}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {isAdmin && (
            <OwnerSection selectedDate={selectedDate} ownerTab={ownerTab} setOwnerTab={setOwnerTab} deposits={deposits} />
          )}
        </>
      )}
    </div>
  );
}

function OwnerSection({ selectedDate, ownerTab, setOwnerTab, deposits }: { selectedDate: string; ownerTab: string; setOwnerTab: (t: string) => void; deposits: any[] }) {
  const { toast } = useToast();

  const { data: dailyReport, isLoading: reportLoading } = useQuery({
    queryKey: ["/api/cash/daily-report", selectedDate],
    queryFn: async () => { const res = await apiRequest("GET", `/api/cash/daily-report?date=${selectedDate}`); return res.json(); },
  });

  const { data: trends } = useQuery({
    queryKey: ["/api/cash/trends"],
    queryFn: async () => { const res = await apiRequest("GET", "/api/cash/trends?days=30"); return res.json(); },
  });

  const [investigationData, setInvestigationData] = useState<any>(null);
  const [investigating, setInvestigating] = useState(false);

  const reviewMutation = useMutation({
    mutationFn: async ({ depositId, status, reviewNotes }: { depositId: string; status: string; reviewNotes?: string }) => {
      await apiRequest("PUT", `/api/cash/deposits/${depositId}/review`, { status, reviewNotes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/deposits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash/daily-report"] });
      toast({ title: "Review saved" });
    },
  });

  const runInvestigation = async () => {
    setInvestigating(true);
    try {
      const res = await apiRequest("GET", "/api/cash/investigation?days=90");
      const data = await res.json();
      setInvestigationData(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setInvestigating(false);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <i className="fas fa-shield-alt text-amber-500" /> Owner Review
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={ownerTab} onValueChange={setOwnerTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="investigation">Investigation</TabsTrigger>
          </TabsList>

          <TabsContent value="daily" className="space-y-3 mt-3">
            {reportLoading ? <Skeleton className="h-20" /> : dailyReport && (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Sessions: </span><span className="font-medium">{dailyReport.sessions?.length || 0}</span></div>
                  <div><span className="text-muted-foreground">Over/Short: </span>
                    <span className={cn("font-medium", dailyReport.totalOverShort === 0 ? "text-green-600" : "text-red-600")}>
                      ${dailyReport.totalOverShort?.toFixed(2) || "0.00"}
                    </span>
                  </div>
                  <div><span className="text-muted-foreground">Expected Deposit: </span><span className="font-medium">${dailyReport.totalExpectedDeposit?.toFixed(2) || "0.00"}</span></div>
                  <div><span className="text-muted-foreground">On Duty: </span><span className="font-medium">{dailyReport.employeesOnDuty?.length || 0} employees</span></div>
                </div>

                {dailyReport.sessions?.map((s: any) => (
                  <div key={s.id} className="p-2 rounded border text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{s.registerName} — {s.sessionType}</span>
                      <Badge variant={s.status === "verified" ? "default" : s.status === "flagged" ? "destructive" : "secondary"} className="text-xs">{s.status}</Badge>
                    </div>
                    {s.totalCashCounted && <p>Counted: ${parseFloat(s.totalCashCounted).toFixed(2)}</p>}
                    {s.overShortAmount && Math.abs(parseFloat(s.overShortAmount)) >= 0.01 && (
                      <p className={parseFloat(s.overShortAmount) < 0 ? "text-red-500" : "text-yellow-500"}>
                        Over/Short: ${parseFloat(s.overShortAmount).toFixed(2)}
                      </p>
                    )}
                  </div>
                ))}

                {deposits.filter((d: any) => d.status === "pending").map((dep: any) => (
                  <div key={dep.id} className="p-3 rounded border space-y-2">
                    <p className="font-medium text-sm">Deposit needs review</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="default" onClick={() => reviewMutation.mutate({ depositId: dep.id, status: "approved" })}>
                        <i className="fas fa-check mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ depositId: dep.id, status: "flagged", reviewNotes: "Needs investigation" })}>
                        <i className="fas fa-flag mr-1" /> Flag
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="trends" className="space-y-3 mt-3">
            {trends ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Total Events: </span><span className="font-medium">{trends.totalEvents}</span></div>
                  <div><span className="text-muted-foreground">Net Amount: </span>
                    <span className={cn("font-medium", trends.totalAmount >= 0 ? "text-yellow-600" : "text-red-600")}>
                      ${trends.totalAmount?.toFixed(2)}
                    </span>
                  </div>
                </div>
                {trends.dailyTrend?.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium">Last 30 Days</p>
                    <div className="flex items-end gap-1 h-24">
                      {trends.dailyTrend.map((d: any) => {
                        const maxAbs = Math.max(...trends.dailyTrend.map((t: any) => Math.abs(t.totalOverShort)), 1);
                        const height = Math.max(4, (Math.abs(d.totalOverShort) / maxAbs) * 80);
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center justify-end" title={`${d.date}: $${d.totalOverShort.toFixed(2)}`}>
                            <div
                              className={cn("w-full rounded-sm min-w-[3px]", d.totalOverShort < 0 ? "bg-red-400" : "bg-yellow-400")}
                              style={{ height: `${height}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{trends.dailyTrend[0]?.date?.slice(5)}</span>
                      <span>{trends.dailyTrend[trends.dailyTrend.length - 1]?.date?.slice(5)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No discrepancies in the last 30 days</p>
                )}
              </>
            ) : (
              <Skeleton className="h-20" />
            )}
          </TabsContent>

          <TabsContent value="investigation" className="space-y-3 mt-3">
            {!investigationData ? (
              <div className="text-center py-6 space-y-3">
                <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
                  <i className="fas fa-search-dollar text-2xl text-amber-600" />
                </div>
                <p className="text-sm text-muted-foreground">AI will analyze 90 days of cash data to detect patterns and anomalies.</p>
                <Button onClick={runInvestigation} disabled={investigating}>
                  {investigating ? (
                    <><i className="fas fa-spinner fa-spin mr-2" /> Analyzing...</>
                  ) : (
                    <><i className="fas fa-search mr-2" /> Run Investigation</>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold border-4",
                    investigationData.riskScore <= 3 ? "border-green-400 text-green-600" :
                    investigationData.riskScore <= 6 ? "border-yellow-400 text-yellow-600" :
                    "border-red-400 text-red-600"
                  )}>
                    {investigationData.riskScore}/10
                  </div>
                  <div>
                    <p className="font-semibold">Risk Score</p>
                    <p className="text-sm text-muted-foreground">{investigationData.totalEvents} discrepancy events analyzed</p>
                  </div>
                </div>

                {investigationData.summary && (
                  <p className="text-sm bg-muted/50 p-3 rounded">{investigationData.summary}</p>
                )}

                {investigationData.findings?.map((f: any, i: number) => (
                  <Card key={i} className={cn("border-l-4",
                    f.level === "critical" ? "border-l-red-500" :
                    f.level === "warning" ? "border-l-yellow-500" : "border-l-blue-500"
                  )}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={f.level === "critical" ? "destructive" : f.level === "warning" ? "outline" : "secondary"} className="text-xs">
                          {f.level}
                        </Badge>
                        <span className="font-medium text-sm">{f.title}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{f.detail}</p>
                    </CardContent>
                  </Card>
                ))}

                {investigationData.recommendations?.length > 0 && (
                  <div>
                    <p className="font-medium text-sm mb-2">Recommendations</p>
                    <ul className="space-y-1">
                      {investigationData.recommendations.map((r: string, i: number) => (
                        <li key={i} className="text-sm flex gap-2">
                          <i className="fas fa-lightbulb text-amber-500 mt-0.5 flex-shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button variant="outline" size="sm" onClick={runInvestigation} disabled={investigating}>
                  <i className="fas fa-redo mr-1" /> Re-run Analysis
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
