import { useState, useEffect, useRef } from "react";
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

function formatRelativeTime(date: Date | null): string {
  if (!date) return '';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes === 1) return 'Synced 1 min ago';
  if (minutes < 60) return `Synced ${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'Synced 1 hr ago' : `Synced ${hours} hrs ago`;
}

export default function CashManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role?.name === 'owner' || user?.role?.name === 'admin' || user?.role?.name === 'manager';
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [activeSession, setActiveSession] = useState<{ id: string; type: "opening" | "closing"; registerName: string; startingCash: number } | null>(null);
  const [ownerTab, setOwnerTab] = useState("daily");
  const [expandedDepositSlip, setExpandedDepositSlip] = useState<string | null>(null);
  const [activeDepositSessionId, setActiveDepositSessionId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [expandedTenderBreakdown, setExpandedTenderBreakdown] = useState<Set<string>>(new Set());
  const isFirstRender = useRef(true);
  const autoSyncRef = useRef(false);
  const mountSyncDoneRef = useRef(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  // null = no sync attempted yet; string[] = sync ran (may be empty — don't fall back to settings)
  const [syncedRegisterNames, setSyncedRegisterNames] = useState<string[] | null>(null);
  const [, setTick] = useState(0);

  // Re-render every minute so the "X min ago" label stays accurate
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: accessCheck, isLoading: accessLoading } = useQuery<{
    allowed: boolean;
    clockedIn: boolean;
    atStore: boolean;
  }>({
    queryKey: ["/api/cash/access-check"],
    refetchInterval: 30000,
  });
  const { data: settings, isLoading: settingsLoading } = useQuery<{
    closingTime: Record<string, string | null> | null;
    defaultStartingCash: string;
    [key: string]: unknown;
  }>({ queryKey: ["/api/cash/settings"], enabled: accessCheck?.allowed });
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({ queryKey: ["/api/cash/sessions", selectedDate], enabled: accessCheck?.allowed, queryFn: async () => {
    const res = await apiRequest("GET", `/api/cash/sessions?date=${selectedDate}`);
    return res.json();
  }});
  const { data: deposits = [], isLoading: depositsLoading } = useQuery({ queryKey: ["/api/cash/deposits", selectedDate], enabled: accessCheck?.allowed, queryFn: async () => {
    const res = await apiRequest("GET", `/api/cash/deposits?date=${selectedDate}`);
    return res.json();
  }});
  const { data: shopifySessions = [] } = useQuery({ queryKey: ["/api/cash/shopify-sessions", selectedDate], enabled: accessCheck?.allowed, queryFn: async () => {
    const res = await apiRequest("GET", `/api/cash/shopify-sessions?date=${selectedDate}`);
    return res.json();
  }});

  // Reset timestamp and synced register names whenever the user switches to a different day
  useEffect(() => {
    setLastSyncedAt(null);
    setSyncedRegisterNames(null);
  }, [selectedDate]);

  // Seed lastSyncedAt from the most recent syncedAt across all returned sessions
  useEffect(() => {
    const sessions = shopifySessions as any[];
    if (!sessions.length) return;
    const maxSyncedAt = sessions.reduce((max: string | null, s: any) => {
      if (!s.syncedAt) return max;
      return !max || s.syncedAt > max ? s.syncedAt : max;
    }, null);
    if (maxSyncedAt) setLastSyncedAt(new Date(maxSyncedAt));
  }, [shopifySessions]);

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

  const syncShopifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cash/sync-shopify?date=${selectedDate}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/shopify-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      if (!data.noShopify) setLastSyncedAt(new Date());
      // Always record the synced register list (even if empty) so we don't
      // revert to stale manual settings.registers after a real sync.
      if (Array.isArray(data.registerNames) && !data.noShopify) {
        setSyncedRegisterNames(data.registerNames);
      }
      const isAuto = autoSyncRef.current;
      autoSyncRef.current = false;
      if (isAuto) return;
      if (data.noShopify) {
        toast({ title: "No Shopify Store", description: "Connect a Shopify store first.", variant: "destructive" });
      } else if (data.synced === 0) {
        toast({ title: "Sync Complete", description: data.message || "No new sessions found." });
      } else {
        toast({ title: "Synced!", description: `Pulled ${data.synced} register session(s) from Shopify.` });
      }
    },
    onError: (err: any) => {
      const isAuto = autoSyncRef.current;
      autoSyncRef.current = false;
      if (!isAuto) {
        toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
      }
    },
  });

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!accessCheck?.allowed) return;
    if (syncShopifyMutation.isPending) return;
    autoSyncRef.current = true;
    syncShopifyMutation.mutate();
  }, [selectedDate]);

  useEffect(() => {
    if (!accessCheck?.allowed) return;
    if (mountSyncDoneRef.current) return;
    mountSyncDoneRef.current = true;
    autoSyncRef.current = true;
    syncShopifyMutation.mutate();
  }, [accessCheck?.allowed]);

  const notesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await apiRequest("PATCH", `/api/cash/sessions/${id}/notes`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      toast({ title: "Notes saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Prefer register names from the most recent Shopify sync.
  // syncedRegisterNames === null  → no sync run yet → use settings.registers
  // syncedRegisterNames === []    → sync ran, Shopify returned none → show nothing (don't revert to manual list)
  // syncedRegisterNames === [...]  → use Shopify-derived list
  const registers: { name: string; id: string }[] = (() => {
    if (syncedRegisterNames !== null) {
      return syncedRegisterNames.map(name => ({ name, id: name }));
    }
    const fromSettings = settings?.registers as any[] | undefined;
    if (fromSettings && fromSettings.length > 0) return fromSettings;
    return [{ name: "Register 1", id: "register-1" }];
  })();

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
                ? "You're clocked in but not at the store location. Open/Close is only available when you're physically at the store."
                : "You need to be clocked in and at the store to access Open/Close. Please clock in first, then come back here."}
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
    const shopifySnapshot = (shopifySessions as any[]).find((s: any) => s.registerName === activeSession.registerName);
    return (
      <div className="h-[calc(100vh-4rem)]">
        <CashCountingWizard
          sessionId={activeSession.id}
          sessionType={activeSession.type}
          registerName={activeSession.registerName}
          startingCash={activeSession.startingCash}
          shopifySnapshot={shopifySnapshot || null}
          shopifySyncing={syncShopifyMutation.isPending}
          onSyncShopify={() => {
            autoSyncRef.current = false;
            syncShopifyMutation.mutate();
          }}
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
          sessionId={activeDepositSessionId}
          onComplete={() => { setViewMode("main"); setActiveDepositSessionId(null); }}
          onCancel={() => { setViewMode("main"); setActiveDepositSessionId(null); }}
        />
      </div>
    );
  }

  const openingSessions = sessions.filter((s: any) => s.sessionType === "opening");
  const closingSessions = sessions.filter((s: any) => s.sessionType === "closing");
  const hasDeposit = deposits.length > 0;

  const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  const todayClosingTime = (() => {
    const perDay = settings?.closingTime;
    if (!perDay || typeof perDay !== "object" || Array.isArray(perDay)) return null;
    const key = DAY_KEYS[new Date().getDay()];
    const val = perDay[key];
    return val && /^([01]\d|2[0-3]):[0-5]\d$/.test(val) ? val : null;
  })();
  const closingTimeBlocked = (() => {
    if (!todayClosingTime) return false;
    const [h, m] = todayClosingTime.split(":").map(Number);
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes() < h * 60 + m;
  })();
  const closingTimeFormatted = todayClosingTime
    ? new Date(0, 0, 0, ...todayClosingTime.split(":").map(Number) as [number, number]).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : null;

  const getRegisterStatus = (regName: string) => {
    const opening = openingSessions.find((s: any) => s.registerName === regName);
    const closing = closingSessions.find((s: any) => s.registerName === regName);
    const shopify = (shopifySessions as any[]).find((s: any) => s.registerName === regName);
    return { opening, closing, shopify };
  };

  const totalOverShort = sessions
    .filter((s: any) => s.overShortAmount)
    .reduce((sum: number, s: any) => sum + parseFloat(s.overShortAmount), 0);

  const depositsForSession = (sessionId: string | undefined) => {
    if (!sessionId) return [];
    return (deposits as any[]).filter((d: any) => d.drawerSessionId === sessionId && d.depositSlipPhoto);
  };

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <i className="fas fa-cash-register text-primary" /> Open/Close
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
              <p className="text-lg font-bold">{openingSessions.length}/{registers.length}</p>
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

          <div className="space-y-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 border-dashed"
              onClick={() => syncShopifyMutation.mutate()}
              disabled={syncShopifyMutation.isPending}
            >
              {syncShopifyMutation.isPending
                ? <><i className="fas fa-spinner fa-spin" /> Syncing from Shopify...</>
                : <><i className="fab fa-shopify text-green-600" /> Sync from Shopify</>}
            </Button>
            {lastSyncedAt && (
              <p className="text-[10px] text-center text-muted-foreground">
                {formatRelativeTime(lastSyncedAt)}
              </p>
            )}
          </div>

          {(shopifySessions as any[]).length > 0 && (
            <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10">
              <CardContent className="p-3">
                <p className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1 mb-2">
                  <i className="fab fa-shopify" /> Shopify POS Data
                </p>
                <div className="space-y-1">
                  {(shopifySessions as any[]).map((s: any) => (
                    <div key={s.id} className="grid grid-cols-3 gap-2 text-xs">
                      <span className="font-medium truncate">{s.registerName}</span>
                      <span className="text-muted-foreground">Cash Sales: <span className="font-medium text-foreground">${parseFloat(s.cashSales || "0").toFixed(2)}</span></span>
                      <span className="text-muted-foreground">Total: <span className="font-medium text-foreground">${parseFloat(s.totalSales || "0").toFixed(2)}</span></span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {registers.map((reg: any) => {
              const { opening, closing, shopify } = getRegisterStatus(reg.name);
              const regDeposits = closing ? depositsForSession(closing.id) : [];
              const allSessions = [opening, closing].filter(Boolean);

              return (
                <Card key={reg.name}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold flex items-center gap-2">
                        <i className="fas fa-tablet-alt text-muted-foreground" />
                        {reg.name}
                        {shopify && (
                          <Badge variant="outline" className="text-green-600 border-green-300 text-[10px]">
                            <i className="fab fa-shopify mr-1" /> Synced
                          </Badge>
                        )}
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
                        ) : opening && opening.status === "pending" ? (
                          <div className="text-sm">
                            <p className="font-medium text-amber-600 flex items-center gap-1">
                              <i className="fas fa-spinner fa-spin" />
                              In Progress
                            </p>
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
                            {closing.registerCashSales && (
                              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                {shopify
                                  ? <><i className="fab fa-shopify text-green-500" /> Cash Sales: ${parseFloat(closing.registerCashSales).toFixed(2)}</>
                                  : <>Cash Sales: ${parseFloat(closing.registerCashSales).toFixed(2)}</>
                                }
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Button size="sm" variant="outline" className="w-full h-10"
                              onClick={() => createSessionMutation.mutate({
                                sessionType: "closing", registerName: reg.name,
                                startingCash: settings?.defaultStartingCash || "200.00",
                              })}
                              disabled={createSessionMutation.isPending || selectedDate !== today || !opening || opening.status === "pending" || closingTimeBlocked}>
                              <i className="fas fa-door-closed mr-1" /> Close Drawer
                            </Button>
                            {closingTimeBlocked && closingTimeFormatted && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <i className="fas fa-clock" /> Available after {closingTimeFormatted}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {shopify && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <div>
                            <p>Cash Sales</p>
                            <p className="font-semibold text-foreground">${parseFloat(shopify.cashSales || "0").toFixed(2)}</p>
                          </div>
                          <div>
                            <p>Total Sales</p>
                            <p className="font-semibold text-foreground">${parseFloat(shopify.totalSales || "0").toFixed(2)}</p>
                          </div>
                          <div>
                            <p>Status</p>
                            <p className="font-semibold text-foreground capitalize">{shopify.status?.toLowerCase() || "—"}</p>
                          </div>
                        </div>
                        {shopify.tenderBreakdown && shopify.tenderBreakdown.length > 0 && (
                          <div>
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                              onClick={() => setExpandedTenderBreakdown(prev => {
                                const key = reg.id ?? reg.name;
                                const next = new Set(prev);
                                next.has(key) ? next.delete(key) : next.add(key);
                                return next;
                              })}
                            >
                              <i className={`fas fa-chevron-${expandedTenderBreakdown.has(reg.id ?? reg.name) ? "up" : "down"} text-[10px]`} />
                              Payment Breakdown
                            </button>
                            {expandedTenderBreakdown.has(reg.id ?? reg.name) && (
                              <div className="mt-1.5 space-y-1 pl-1">
                                {shopify.tenderBreakdown.map((t: any, i: number) => (
                                  <div key={i} className="flex justify-between text-xs">
                                    <span className="text-muted-foreground capitalize">{t.tenderType ? t.tenderType.toLowerCase().replace(/_/g, " ") : "unknown"}</span>
                                    <span className="font-medium">${parseFloat(t.amount?.shopMoney?.amount || "0").toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {regDeposits.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1">
                          <i className="fas fa-receipt" /> Store Deposit Slip{regDeposits.length > 1 ? "s" : ""}
                        </p>
                        {regDeposits.map((dep: any) => (
                          <div
                            key={dep.id}
                            className="relative cursor-pointer mb-1"
                            onClick={() => setExpandedDepositSlip(expandedDepositSlip === dep.id ? null : dep.id)}
                          >
                            <img
                              src={dep.depositSlipPhoto}
                              alt="Deposit slip"
                              className={cn(
                                "w-full rounded border object-contain transition-all",
                                expandedDepositSlip === dep.id ? "max-h-96" : "max-h-20"
                              )}
                            />
                            <div className="absolute top-1 right-1 bg-black/50 text-white text-[10px] rounded px-1">
                              {expandedDepositSlip === dep.id ? "Collapse" : "Expand"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {closing && (closing.status === "counted" || closing.status === "verified") && regDeposits.length === 0 && selectedDate === today && (
                      <div className="mt-3 pt-3 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-8 text-xs border-dashed text-muted-foreground"
                          onClick={() => { setActiveDepositSessionId(closing.id); setViewMode("deposit"); }}
                        >
                          <i className="fas fa-receipt mr-1" /> Add Deposit Slip
                        </Button>
                      </div>
                    )}

                    {allSessions.map((sess: any) => (
                      <div key={sess.id} className="mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1">
                          <i className="fas fa-sticky-note" /> Notes ({sess.sessionType})
                        </p>
                        <Textarea
                          rows={2}
                          className="text-sm resize-none"
                          placeholder="Add notes for this session..."
                          value={notesDraft[sess.id] !== undefined ? notesDraft[sess.id] : (sess.notes || "")}
                          onChange={(e) => setNotesDraft(prev => ({ ...prev, [sess.id]: e.target.value }))}
                        />
                        {notesDraft[sess.id] !== undefined && notesDraft[sess.id] !== (sess.notes || "") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1 h-7 text-xs"
                            onClick={() => {
                              notesMutation.mutate({ id: sess.id, notes: notesDraft[sess.id] });
                              setNotesDraft(prev => { const n = { ...prev }; delete n[sess.id]; return n; });
                            }}
                            disabled={notesMutation.isPending}
                          >
                            <i className="fas fa-save mr-1" /> Save Notes
                          </Button>
                        )}
                      </div>
                    ))}
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
            <OwnerSection selectedDate={selectedDate} ownerTab={ownerTab} setOwnerTab={setOwnerTab} deposits={deposits} settings={settings} />
          )}
        </>
      )}
    </div>
  );
}

function ReconciliationRow({ dep, threshold }: { dep: any; threshold: number }) {
  const [open, setOpen] = useState(false);
  const hasRecon = dep.shopifyExpectedCash != null || dep.physicalCountCash != null;
  if (!hasRecon) return null;
  const svcd = dep.shopifyVsCountDelta != null ? parseFloat(dep.shopifyVsCountDelta) : null;
  const cvdd = dep.countVsDepositDelta != null ? parseFloat(dep.countVsDepositDelta) : null;
  const status = dep.reconciliationStatus;

  const statusColor = status === "discrepancy"
    ? "text-red-600 dark:text-red-400"
    : status === "within_tolerance"
    ? "text-amber-600 dark:text-amber-400"
    : "text-green-600 dark:text-green-400";

  const statusLabel = status === "discrepancy" ? "Discrepancy" : status === "within_tolerance" ? "Within Tolerance" : "Matched";

  function deltaChip(delta: number | null, label: string) {
    if (delta == null) return null;
    const abs = Math.abs(delta);
    const isExact = abs < 0.01;
    const exceeds = abs > threshold;
    const cls = isExact
      ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
      : exceeds
      ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
      : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
    const val = isExact ? "✓" : delta > 0 ? `+$${abs.toFixed(2)}` : `-$${abs.toFixed(2)}`;
    return (
      <span key={label} className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium", cls)}>
        {label}: {val}
      </span>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        onClick={() => setOpen(o => !o)}
      >
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[10px]`} />
        <i className="fas fa-balance-scale text-[10px]" />
        Reconciliation
        <span className={cn("ml-auto font-medium", statusColor)}>{statusLabel}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-3 gap-1 text-[11px]">
            {dep.shopifyExpectedCash != null && (
              <div className="text-center p-1.5 rounded bg-muted/40">
                <p className="text-muted-foreground">Shopify</p>
                <p className="font-semibold">${parseFloat(dep.shopifyExpectedCash).toFixed(2)}</p>
              </div>
            )}
            {dep.physicalCountCash != null && (
              <div className="text-center p-1.5 rounded bg-muted/40">
                <p className="text-muted-foreground">Physical</p>
                <p className="font-semibold">${parseFloat(dep.physicalCountCash).toFixed(2)}</p>
              </div>
            )}
            {dep.aiExtractedAmount != null && (
              <div className="text-center p-1.5 rounded bg-muted/40">
                <p className="text-muted-foreground">Slip (AI)</p>
                <p className="font-semibold">${parseFloat(dep.aiExtractedAmount).toFixed(2)}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {deltaChip(svcd, "vs Count")}
            {deltaChip(cvdd, "vs Deposit")}
            {dep.shopifyVsDepositDelta != null && deltaChip(parseFloat(dep.shopifyVsDepositDelta), "Shopify vs Slip")}
          </div>
          {Array.isArray(dep.sessionBreakdown) && dep.sessionBreakdown.length > 1 && (
            <div className="pt-1 border-t space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Per-Register Breakdown</p>
              {(dep.sessionBreakdown as Array<{ registerName: string; shopifyExpected: number | null; physicalCount: number | null; shopifyVsCountDelta: number | null; exceeds: boolean }>).map((entry) => {
                const abs = entry.shopifyVsCountDelta != null ? Math.abs(entry.shopifyVsCountDelta) : null;
                const isExact = abs != null && abs < 0.01;
                const cls = isExact
                  ? "text-green-700 dark:text-green-300"
                  : entry.exceeds
                  ? "text-red-700 dark:text-red-300"
                  : "text-amber-700 dark:text-amber-300";
                const deltaText = entry.shopifyVsCountDelta == null
                  ? "—"
                  : isExact
                  ? "✓"
                  : entry.shopifyVsCountDelta > 0
                  ? `+$${abs!.toFixed(2)}`
                  : `-$${abs!.toFixed(2)}`;
                return (
                  <div key={entry.registerName} className="flex items-center justify-between text-[10px] px-1.5 py-1 rounded bg-muted/30">
                    <span className="font-medium text-foreground">{entry.registerName}</span>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {entry.shopifyExpected != null && <span>Shopify <span className="text-foreground font-medium">${entry.shopifyExpected.toFixed(2)}</span></span>}
                      {entry.physicalCount != null && <span>Physical <span className="text-foreground font-medium">${entry.physicalCount.toFixed(2)}</span></span>}
                      <span className={cn("font-semibold", cls)}>{deltaText}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DepositReviewCard({ dep, onApprove, onFlag, isPending, threshold }: { dep: any; onApprove: () => void; onFlag: () => void; isPending: boolean; threshold: number }) {
  return (
    <div className="p-2 rounded border text-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">Bank Deposit</span>
        <Badge variant={dep.status === "approved" ? "default" : dep.status === "flagged" ? "destructive" : "secondary"} className="text-xs">
          {dep.status}
        </Badge>
      </div>
      {dep.depositSlipPhoto && (
        <img src={dep.depositSlipPhoto} alt="Deposit slip" className="w-full max-h-32 object-contain rounded border" />
      )}
      <ReconciliationRow dep={dep} threshold={threshold} />
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs text-green-600"
          onClick={onApprove} disabled={isPending}>
          <i className="fas fa-check mr-1" /> Approve
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-8 text-xs text-red-600"
          onClick={onFlag} disabled={isPending}>
          <i className="fas fa-flag mr-1" /> Flag
        </Button>
      </div>
    </div>
  );
}

function OwnerSection({ selectedDate, ownerTab, setOwnerTab, deposits, settings }: { selectedDate: string; ownerTab: string; setOwnerTab: (t: string) => void; deposits: any[]; settings: any }) {
  const { toast } = useToast();
  const refSlipInputRef = useRef<HTMLInputElement>(null);

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
  const [referenceSlipPreview, setReferenceSlipPreview] = useState<string | null>(settings?.referenceDepositSlip || null);
  const [depositToleranceInput, setDepositToleranceInput] = useState<string>(settings?.depositTolerance || "1.00");
  const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  type DayKey = typeof DAYS_OF_WEEK[number];
  const DAY_LABELS: Record<DayKey, string> = { sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday" };

  const defaultClosingTimes = (): Record<DayKey, string> =>
    Object.fromEntries(DAYS_OF_WEEK.map(d => [d, ""])) as Record<DayKey, string>;

  const settingsToClosingInputs = (s: { closingTime?: Record<string, string | null> | null } | undefined): Record<DayKey, string> => {
    const ct = s?.closingTime;
    if (ct && typeof ct === "object" && !Array.isArray(ct)) {
      return Object.fromEntries(DAYS_OF_WEEK.map(d => [d, ct[d] || ""])) as Record<DayKey, string>;
    }
    return defaultClosingTimes();
  };

  const [closingTimeInputs, setClosingTimeInputs] = useState<Record<DayKey, string>>(settingsToClosingInputs(settings));
  const [applyAllTime, setApplyAllTime] = useState<string>("");

  useEffect(() => {
    setReferenceSlipPreview(settings?.referenceDepositSlip || null);
    setDepositToleranceInput(settings?.depositTolerance || "1.00");
  }, [settings?.referenceDepositSlip, settings?.depositTolerance]);
  useEffect(() => {
    setClosingTimeInputs(settingsToClosingInputs(settings));
  }, [settings?.closingTime]);

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

  const settingsMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", "/api/cash/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="investigation">Investigation</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
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
                      <span className={cn("text-xs", parseFloat(s.overShortAmount || "0") > 0 ? "text-yellow-600" : parseFloat(s.overShortAmount || "0") < 0 ? "text-red-600" : "text-green-600")}>
                        {parseFloat(s.overShortAmount || "0") > 0 ? "+" : ""}${parseFloat(s.overShortAmount || "0").toFixed(2)}
                      </span>
                    </div>
                    {s.countedBy && <p className="text-xs text-muted-foreground">By: {s.countedBy}</p>}
                  </div>
                ))}

                {deposits.map((dep: any) => (
                  <DepositReviewCard
                    key={dep.id}
                    dep={dep}
                    onApprove={() => reviewMutation.mutate({ depositId: dep.id, status: "approved" })}
                    onFlag={() => reviewMutation.mutate({ depositId: dep.id, status: "flagged" })}
                    isPending={reviewMutation.isPending}
                    threshold={parseFloat(settings?.overShortThreshold || "5")}
                  />
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

          <TabsContent value="settings" className="space-y-4 mt-3">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Closing Times by Day</label>
                <p className="text-xs text-muted-foreground mb-3">
                  Employees cannot start a closing count before this time on the given day. Leave a day blank to allow closing counts at any time on that day.
                </p>
                <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-muted/50">
                  <span className="text-sm text-muted-foreground shrink-0">Apply to all days:</span>
                  <Input
                    type="time"
                    value={applyAllTime}
                    onChange={(e) => setApplyAllTime(e.target.value)}
                    className="w-36"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!applyAllTime}
                    onClick={() => {
                      setClosingTimeInputs(Object.fromEntries(DAYS_OF_WEEK.map(d => [d, applyAllTime])) as Record<DayKey, string>);
                    }}
                  >
                    Apply to all
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <div key={day} className="flex items-center gap-2">
                      <span className="text-sm w-24 shrink-0">{DAY_LABELS[day]}</span>
                      <Input
                        type="time"
                        value={closingTimeInputs[day]}
                        onChange={(e) => setClosingTimeInputs(prev => ({ ...prev, [day]: e.target.value }))}
                        className="w-36"
                      />
                      {closingTimeInputs[day] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setClosingTimeInputs(prev => ({ ...prev, [day]: "" }))}
                          className="text-muted-foreground px-2"
                        >
                          <i className="fas fa-times" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Deposit Tolerance ($)</label>
                <p className="text-xs text-muted-foreground mb-1">
                  If the actual deposit differs from expected by more than this amount, the owner receives an alert.
                </p>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-36"
                  value={depositToleranceInput}
                  onChange={(e) => setDepositToleranceInput(e.target.value)}
                  placeholder="1.00"
                />
              </div>

              <div>
                <label className="text-sm font-medium">Reference Deposit Slip Template</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Upload a sample bank deposit slip. AI will use this as a visual template to validate employee submissions.
                </p>
                <input
                  ref={refSlipInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const result = ev.target?.result as string;
                      setReferenceSlipPreview(result);
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
                {referenceSlipPreview ? (
                  <div className="space-y-2">
                    <div className="rounded-lg overflow-hidden border max-h-40">
                      <img src={referenceSlipPreview} alt="Reference deposit slip" className="w-full object-contain" />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setReferenceSlipPreview(null)}
                      className="text-red-500 border-red-200 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      <i className="fas fa-times mr-1" /> Remove Reference Slip
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => refSlipInputRef.current?.click()}>
                    <i className="fas fa-upload mr-1" /> Upload Reference Slip
                  </Button>
                )}
              </div>

              <Button
                onClick={() => {
                  const closingTime = Object.fromEntries(
                    DAYS_OF_WEEK.map(d => [d, closingTimeInputs[d] || null])
                  );
                  settingsMutation.mutate({
                    ...settings,
                    closingTime,
                    depositTolerance: depositToleranceInput || "1.00",
                    referenceDepositSlip: referenceSlipPreview || null,
                  });
                }}
                disabled={settingsMutation.isPending}
                size="sm"
              >
                {settingsMutation.isPending ? <><i className="fas fa-spinner fa-spin mr-1" /> Saving...</> : <><i className="fas fa-save mr-1" /> Save Settings</>}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
