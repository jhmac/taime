import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface CashCountingWizardProps {
  sessionId: string;
  sessionType: "opening" | "closing";
  registerName: string;
  startingCash: number;
  shopifySnapshot?: {
    cashSales?: string | null;
    totalSales?: string | null;
    tenderBreakdown?: any[];
    cashMovements?: any[];
    status?: string | null;
    openedAt?: string | null;
    closedAt?: string | null;
  } | null;
  shopifySyncing?: boolean;
  onSyncShopify?: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

interface DenominationStep {
  key: string;
  label: string;
  prompt: string;
  value: number;
  icon: string;
  category: "coin" | "rolled" | "bill";
}

const STEPS: DenominationStep[] = [
  { key: "pennyCount", label: "Pennies", prompt: "How many pennies are in the drawer?", value: 0.01, icon: "1¢", category: "coin" },
  { key: "nickelCount", label: "Nickels", prompt: "How many nickels are in the drawer?", value: 0.05, icon: "5¢", category: "coin" },
  { key: "dimeCount", label: "Dimes", prompt: "How many dimes are in the drawer?", value: 0.10, icon: "10¢", category: "coin" },
  { key: "quarterCount", label: "Quarters", prompt: "How many quarters are in the drawer?", value: 0.25, icon: "25¢", category: "coin" },
  { key: "rolledCoins", label: "Rolled Coins", prompt: "How many rolls of each coin?", value: 0, icon: "rolls", category: "rolled" },
  { key: "oneCount", label: "$1 Bills", prompt: "How many $1 bills?", value: 1, icon: "$1", category: "bill" },
  { key: "fiveCount", label: "$5 Bills", prompt: "How many $5 bills?", value: 5, icon: "$5", category: "bill" },
  { key: "tenCount", label: "$10 Bills", prompt: "How many $10 bills?", value: 10, icon: "$10", category: "bill" },
  { key: "twentyCount", label: "$20 Bills", prompt: "How many $20 bills?", value: 20, icon: "$20", category: "bill" },
  { key: "fiftyCount", label: "$50 Bills", prompt: "How many $50 bills?", value: 50, icon: "$50", category: "bill" },
  { key: "hundredCount", label: "$100 Bills", prompt: "How many $100 bills?", value: 100, icon: "$100", category: "bill" },
];

type WizardPhase = "setup" | "counting" | "review" | "register-data" | "explanation" | "complete" | "recount";

const STORAGE_KEY = "cash-wizard-state";

export default function CashCountingWizard({ sessionId, sessionType, registerName, startingCash, shopifySnapshot, shopifySyncing = false, onSyncShopify, onComplete, onCancel }: CashCountingWizardProps) {
  const { toast } = useToast();

  const [phase, setPhase] = useState<WizardPhase>("setup");
  const [currentStep, setCurrentStep] = useState(0);
  const [quickMode, setQuickMode] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({
    pennyCount: 0, nickelCount: 0, dimeCount: 0, quarterCount: 0,
    rolledPennyCount: 0, rolledNickelCount: 0, rolledDimeCount: 0, rolledQuarterCount: 0,
    oneCount: 0, fiveCount: 0, tenCount: 0, twentyCount: 0, fiftyCount: 0, hundredCount: 0,
  });
  const [registerData, setRegisterData] = useState({
    cashSales: shopifySnapshot?.cashSales || "",
    totalSales: shopifySnapshot?.totalSales || "",
    shopifyPayments: "",
  });
  const [explanation, setExplanation] = useState("");
  const [recountSuggestion, setRecountSuggestion] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sessionId === sessionId) {
          setCounts(parsed.counts || counts);
          setPhase(parsed.phase || "setup");
          setCurrentStep(parsed.currentStep || 0);
          setQuickMode(parsed.quickMode || false);
          if (parsed.registerData) setRegisterData(parsed.registerData);
          if (parsed.explanation) setExplanation(parsed.explanation);
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (shopifySnapshot != null) {
      setRegisterData(prev => ({
        ...prev,
        cashSales: shopifySnapshot.cashSales || prev.cashSales,
        totalSales: shopifySnapshot.totalSales || prev.totalSales,
      }));
    }
  }, [shopifySnapshot]);

  useEffect(() => {
    if (phase !== "complete") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, counts, phase, currentStep, quickMode, registerData, explanation }));
    }
  }, [counts, phase, currentStep, quickMode, registerData, explanation]);

  const calcDenomValue = useCallback((key: string, count: number) => {
    const step = STEPS.find(s => s.key === key);
    if (!step) return 0;
    return Math.round(count * step.value * 100) / 100;
  }, []);

  const runningTotal = useCallback(() => {
    let total = 0;
    total += (counts.pennyCount || 0) * 0.01;
    total += (counts.nickelCount || 0) * 0.05;
    total += (counts.dimeCount || 0) * 0.10;
    total += (counts.quarterCount || 0) * 0.25;
    total += (counts.rolledPennyCount || 0) * 0.50;
    total += (counts.rolledNickelCount || 0) * 2;
    total += (counts.rolledDimeCount || 0) * 5;
    total += (counts.rolledQuarterCount || 0) * 10;
    total += (counts.oneCount || 0) * 1;
    total += (counts.fiveCount || 0) * 5;
    total += (counts.tenCount || 0) * 10;
    total += (counts.twentyCount || 0) * 20;
    total += (counts.fiftyCount || 0) * 50;
    total += (counts.hundredCount || 0) * 100;
    return Math.round(total * 100) / 100;
  }, [counts]);

  const coinsSubtotal = useCallback(() => {
    return Math.round((
      (counts.pennyCount || 0) * 0.01 + (counts.nickelCount || 0) * 0.05 +
      (counts.dimeCount || 0) * 0.10 + (counts.quarterCount || 0) * 0.25 +
      (counts.rolledPennyCount || 0) * 0.50 + (counts.rolledNickelCount || 0) * 2 +
      (counts.rolledDimeCount || 0) * 5 + (counts.rolledQuarterCount || 0) * 10
    ) * 100) / 100;
  }, [counts]);

  const billsSubtotal = useCallback(() => {
    return Math.round((
      (counts.oneCount || 0) * 1 + (counts.fiveCount || 0) * 5 + (counts.tenCount || 0) * 10 +
      (counts.twentyCount || 0) * 20 + (counts.fiftyCount || 0) * 50 + (counts.hundredCount || 0) * 100
    ) * 100) / 100;
  }, [counts]);

  const overShort = useCallback(() => {
    const total = runningTotal();
    if (sessionType === "closing" && registerData.cashSales) {
      return Math.round((total - startingCash - parseFloat(registerData.cashSales || "0")) * 100) / 100;
    }
    return Math.round((total - startingCash) * 100) / 100;
  }, [runningTotal, startingCash, sessionType, registerData.cashSales]);

  const submitCountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/cash/sessions/${sessionId}/count`, { counts });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      if (sessionType === "closing") {
        setPhase("register-data");
      } else {
        const os = Math.abs(parseFloat(data.session?.overShortAmount || "0"));
        if (os >= 5) {
          setPhase("explanation");
        } else {
          setPhase("complete");
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const submitRegisterDataMutation = useMutation({
    mutationFn: async () => {
      const hasSnap = shopifySnapshot != null;
      const nonCashPayments = hasSnap && shopifySnapshot?.tenderBreakdown
        ? shopifySnapshot.tenderBreakdown
            .filter((t: any) => t.tenderType && t.tenderType.toLowerCase() !== "cash")
            .reduce((sum: number, t: any) => sum + parseFloat(t.amount?.shopMoney?.amount || "0"), 0)
        : null;
      const res = await apiRequest("PUT", `/api/cash/sessions/${sessionId}/register-data`, {
        registerCashSales: hasSnap ? shopifySnapshot!.cashSales : null,
        registerTotalSales: hasSnap ? shopifySnapshot!.totalSales : null,
        registerShopifyPayments: hasSnap && nonCashPayments !== null ? nonCashPayments.toFixed(2) : null,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      const os = Math.abs(parseFloat(data.overShortAmount || "0"));
      if (os >= 5) {
        setPhase("explanation");
      } else {
        setPhase("complete");
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const submitExplanationMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/cash/sessions/${sessionId}/explanation`, { explanation });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      setPhase("complete");
      localStorage.removeItem(STORAGE_KEY);
    },
  });

  const recountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/cash/sessions/${sessionId}/recount`, { counts });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/sessions"] });
      if (sessionType === "closing" && shopifySnapshot == null) {
        setPhase("register-data");
      } else if (sessionType === "closing" && shopifySnapshot != null) {
        submitRegisterDataMutation.mutate();
      } else {
        const os = Math.abs(parseFloat(data.session?.overShortAmount || "0"));
        if (os >= 5) setPhase("explanation");
        else {
          setPhase("complete");
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    },
  });

  const getRecountSuggestion = useCallback(async () => {
    try {
      const res = await apiRequest("POST", "/api/cash/recount-suggestion", { counts });
      const data = await res.json();
      setRecountSuggestion(data.suggestion);
    } catch {
      setRecountSuggestion("Try recounting your largest denomination first.");
    }
  }, [counts]);

  const totalSteps = STEPS.length;
  const progressPercent = phase === "counting" ? Math.round(((currentStep + 1) / totalSteps) * 100) : phase === "review" ? 100 : 0;

  const handleCountChange = (key: string, value: string) => {
    const num = parseInt(value) || 0;
    setCounts(prev => ({ ...prev, [key]: Math.max(0, num) }));
  };

  if (phase === "setup") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <h2 className="font-semibold text-lg">
            {sessionType === "opening" ? "Opening" : "Closing"} Drawer
          </h2>
          <div />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <i className="fas fa-cash-register text-3xl text-primary" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold">{registerName}</h3>
            <p className="text-muted-foreground">
              {sessionType === "opening"
                ? "Let's count your starting cash to make sure you're all set."
                : "Time to close out! Let's count what's in the drawer."}
            </p>
          </div>
          <Card className="w-full max-w-sm">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Starting Cash</p>
              <p className="text-3xl font-bold text-primary">${startingCash.toFixed(2)}</p>
            </CardContent>
          </Card>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="quickMode"
              checked={quickMode}
              onChange={(e) => setQuickMode(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="quickMode" className="text-sm text-muted-foreground">
              Quick mode — show all denominations at once
            </label>
          </div>
          <Button size="lg" className="w-full max-w-sm h-14 text-lg" onClick={() => {
            if (quickMode) setPhase("review");
            else { setPhase("counting"); setCurrentStep(0); }
          }}>
            Let's Count!
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "counting" && !quickMode) {
    const step = STEPS[currentStep];
    const isRolledStep = step.key === "rolledCoins";

    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b space-y-2">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            <span className="text-sm text-muted-foreground">Step {currentStep + 1} of {totalSteps}</span>
            <Button variant="ghost" size="sm" onClick={() => { setPhase("review"); }}>Skip to Review</Button>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <div className={cn(
            "w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold",
            step.category === "coin" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
            step.category === "rolled" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
            "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          )}>
            {step.icon}
          </div>

          <h3 className="text-xl font-bold">{step.label}</h3>
          <p className="text-muted-foreground text-center">{step.prompt}</p>

          {isRolledStep ? (
            <div className="w-full max-w-sm space-y-3">
              {[
                { key: "rolledQuarterCount", label: "Quarters ($10/roll)", value: 10 },
                { key: "rolledDimeCount", label: "Dimes ($5/roll)", value: 5 },
                { key: "rolledNickelCount", label: "Nickels ($2/roll)", value: 2 },
                { key: "rolledPennyCount", label: "Pennies ($0.50/roll)", value: 0.5 },
              ].map(roll => (
                <div key={roll.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium flex-1">{roll.label}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    className="w-24 text-center text-lg h-12"
                    value={counts[roll.key] || ""}
                    onChange={(e) => handleCountChange(roll.key, e.target.value)}
                    placeholder="0"
                  />
                  <span className="text-sm text-muted-foreground w-16 text-right">
                    = ${((counts[roll.key] || 0) * roll.value).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full max-w-sm space-y-3">
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                className="text-center text-4xl h-20 font-bold"
                value={counts[step.key] || ""}
                onChange={(e) => handleCountChange(step.key, e.target.value)}
                placeholder="0"
                autoFocus
              />
              <p className="text-center text-lg text-muted-foreground">
                {counts[step.key] || 0} {step.label.toLowerCase()} = <span className="font-semibold text-foreground">${calcDenomValue(step.key, counts[step.key] || 0).toFixed(2)}</span>
              </p>
            </div>
          )}
        </div>

        <div className="border-t p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Counted so far</span>
            <span className="text-xl font-bold text-primary">${runningTotal().toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-12" onClick={() => {
              if (currentStep > 0) setCurrentStep(currentStep - 1);
              else setPhase("setup");
            }}>
              Back
            </Button>
            <Button className="flex-1 h-12" onClick={() => {
              if (currentStep < totalSteps - 1) setCurrentStep(currentStep + 1);
              else setPhase("review");
            }}>
              {currentStep < totalSteps - 1 ? "Next" : "Review"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "review" || (phase === "counting" && quickMode)) {
    const total = runningTotal();
    const os = overShort();

    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => { setPhase("counting"); setCurrentStep(0); }}>
              Back to Count
            </Button>
            <h2 className="font-semibold">Review Your Count</h2>
            <div />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {quickMode && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase">Quick Entry</h3>
              <div className="grid grid-cols-2 gap-3">
                {STEPS.filter(s => s.key !== "rolledCoins").map(step => (
                  <div key={step.key} className="flex items-center gap-2">
                    <span className="text-xs font-medium w-16 truncate">{step.label}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      className="h-10 text-center"
                      value={counts[step.key] || ""}
                      onChange={(e) => handleCountChange(step.key, e.target.value)}
                      placeholder="0"
                    />
                  </div>
                ))}
                <div className="col-span-2 text-xs font-semibold text-muted-foreground mt-1">Rolled Coins</div>
                {[
                  { key: "rolledQuarterCount", label: "Qtr Rolls" },
                  { key: "rolledDimeCount", label: "Dime Rolls" },
                  { key: "rolledNickelCount", label: "Nickel Rolls" },
                  { key: "rolledPennyCount", label: "Penny Rolls" },
                ].map(roll => (
                  <div key={roll.key} className="flex items-center gap-2">
                    <span className="text-xs font-medium w-16 truncate">{roll.label}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      className="h-10 text-center"
                      value={counts[roll.key] || ""}
                      onChange={(e) => handleCountChange(roll.key, e.target.value)}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold">Count Summary</h3>
              <div className="space-y-1">
                {STEPS.filter(s => s.key !== "rolledCoins").map(step => {
                  const count = counts[step.key] || 0;
                  if (count === 0 && !quickMode) return null;
                  return (
                    <div key={step.key} className="flex justify-between text-sm">
                      <span>{step.label}: {count}</span>
                      <span className="font-medium">${calcDenomValue(step.key, count).toFixed(2)}</span>
                    </div>
                  );
                })}
                {[
                  { key: "rolledQuarterCount", label: "Rolled Quarters", val: 10 },
                  { key: "rolledDimeCount", label: "Rolled Dimes", val: 5 },
                  { key: "rolledNickelCount", label: "Rolled Nickels", val: 2 },
                  { key: "rolledPennyCount", label: "Rolled Pennies", val: 0.5 },
                ].map(r => {
                  const count = counts[r.key] || 0;
                  if (count === 0 && !quickMode) return null;
                  return (
                    <div key={r.key} className="flex justify-between text-sm">
                      <span>{r.label}: {count}</span>
                      <span className="font-medium">${(count * r.val).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Coins</span><span>${coinsSubtotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Bills</span><span>${billsSubtotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-1 border-t">
                  <span>Total Cash</span><span className="text-primary">${total.toFixed(2)}</span>
                </div>
              </div>

              {sessionType === "opening" && (
                <div className={cn("p-3 rounded-lg text-center", Math.abs(os) < 0.01 ? "bg-green-50 dark:bg-green-900/20" : Math.abs(os) < 5 ? "bg-yellow-50 dark:bg-yellow-900/20" : "bg-red-50 dark:bg-red-900/20")}>
                  <p className="text-sm text-muted-foreground">vs Expected ${startingCash.toFixed(2)}</p>
                  <p className={cn("text-xl font-bold", Math.abs(os) < 0.01 ? "text-green-600" : Math.abs(os) < 5 ? "text-yellow-600" : "text-red-600")}>
                    {Math.abs(os) < 0.01 ? "Exact Match!" : os > 0 ? `$${os.toFixed(2)} Over` : `$${Math.abs(os).toFixed(2)} Short`}
                  </p>
                </div>
              )}
              {sessionType === "closing" && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-center">
                  <p className="text-sm text-muted-foreground">Cash to Deposit</p>
                  <p className="text-xl font-bold text-blue-600">${Math.max(0, total - startingCash).toFixed(2)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-muted-foreground">Does this look right?</p>
        </div>

        <div className="border-t p-4 space-y-2">
          <Button className="w-full h-12" onClick={() => submitCountMutation.mutate()} disabled={submitCountMutation.isPending}>
            {submitCountMutation.isPending ? "Submitting..." : "Yes, Submit Count"}
          </Button>
          <Button variant="outline" className="w-full h-12" onClick={() => {
            getRecountSuggestion();
            setPhase("recount");
          }}>
            Something's off — help me recount
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "recount") {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setPhase("review")}>Back</Button>
            <h2 className="font-semibold">Recount</h2>
            <div />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {recountSuggestion && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20">
              <CardContent className="p-4">
                <div className="flex gap-2">
                  <i className="fas fa-lightbulb text-blue-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Recount Suggestion</p>
                    <p className="text-sm text-muted-foreground">{recountSuggestion}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          <p className="text-sm text-muted-foreground">Tap any denomination to jump directly to it and recount:</p>
          <div className="space-y-2">
            {STEPS.filter(s => s.key !== "rolledCoins").map((step) => {
              const stepsIndex = STEPS.findIndex(s => s.key === step.key);
              return (
              <button
                key={step.key}
                className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                onClick={() => { setCurrentStep(stepsIndex); setPhase("counting"); }}
              >
                <div className="flex items-center gap-3">
                  <span className={cn("w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                    step.category === "coin" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  )}>{step.icon}</span>
                  <span className="font-medium">{step.label}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm text-muted-foreground">{counts[step.key] || 0} × </span>
                  <span className="font-medium">${calcDenomValue(step.key, counts[step.key] || 0).toFixed(2)}</span>
                </div>
              </button>
              );
            })}
            <button
              className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
              onClick={() => { setCurrentStep(4); setPhase("counting"); }}
            >
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  <i className="fas fa-coins" />
                </span>
                <span className="font-medium">Rolled Coins</span>
              </div>
            </button>
          </div>
        </div>
        <div className="border-t p-4">
          <Button className="w-full h-12" onClick={() => recountMutation.mutate()} disabled={recountMutation.isPending}>
            {recountMutation.isPending ? "Submitting Recount..." : "Submit Recount"}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "register-data") {
    const total = runningTotal();
    const cashToDeposit = total - startingCash;
    const cashSalesNum = parseFloat(registerData.cashSales || "0");
    const diff = cashSalesNum > 0 ? Math.round((cashToDeposit - cashSalesNum) * 100) / 100 : 0;
    const hasShopifyData = shopifySnapshot != null;

    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setPhase("review")}>Back</Button>
            <h2 className="font-semibold">Register Summary</h2>
            <div />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {hasShopifyData ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <i className="fab fa-shopify text-green-600 text-lg" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">Pulled from Shopify POS</p>
                <p className="text-xs text-green-700 dark:text-green-400">These figures are verified — no manual entry needed.</p>
              </div>
            </div>
          ) : shopifySyncing ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <i className="fab fa-shopify text-blue-600 text-lg" />
              <div>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Syncing Shopify data…</p>
                <p className="text-xs text-blue-700 dark:text-blue-400">Pulling register figures automatically — just a moment.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <i className="fab fa-shopify text-amber-600 text-lg mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Shopify data not yet synced</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">Could not pull register figures automatically.</p>
                {onSyncShopify && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-400 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    onClick={onSyncShopify}
                  >
                    <i className="fas fa-sync mr-1" /> Sync Now
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1 flex items-center gap-1">
                Cash Sales
                {hasShopifyData && <i className="fab fa-shopify text-green-500 text-xs" />}
              </label>
              {shopifySyncing && !hasShopifyData ? (
                <Skeleton className="h-14 w-full rounded-md" />
              ) : (
                <div className={cn("h-14 flex items-center px-4 rounded-md border text-xl font-semibold", hasShopifyData ? "bg-muted/40" : "bg-muted/20 text-muted-foreground")}>
                  {hasShopifyData ? `$${parseFloat(registerData.cashSales || "0").toFixed(2)}` : "—"}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium block mb-1 flex items-center gap-1">
                Total Sales
                {hasShopifyData ? <i className="fab fa-shopify text-green-500 text-xs" /> : null}
              </label>
              {shopifySyncing && !hasShopifyData ? (
                <Skeleton className="h-12 w-full rounded-md" />
              ) : (
                <div className={cn("h-12 flex items-center px-4 rounded-md border font-medium", hasShopifyData ? "bg-muted/40" : "bg-muted/20 text-muted-foreground")}>
                  {hasShopifyData ? `$${parseFloat(registerData.totalSales || "0").toFixed(2)}` : "—"}
                </div>
              )}
            </div>

            {hasShopifyData && shopifySnapshot?.tenderBreakdown && shopifySnapshot.tenderBreakdown.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase">Payment Breakdown</p>
                {shopifySnapshot.tenderBreakdown.map((t: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="capitalize">{t.tenderType?.toLowerCase().replace(/_/g, " ")}</span>
                    <span className="font-medium">${parseFloat(t.amount?.shopMoney?.amount || "0").toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cashSalesNum > 0 && (
            <Card className={cn("border-2",
              Math.abs(diff) < 0.01 ? "border-green-300 dark:border-green-700" :
              Math.abs(diff) < 5 ? "border-yellow-300 dark:border-yellow-700" :
              "border-red-300 dark:border-red-700"
            )}>
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Cash in Drawer (minus starting)</span>
                  <span className="font-medium">${cashToDeposit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Register Cash Sales</span>
                  <span className="font-medium">${cashSalesNum.toFixed(2)}</span>
                </div>
                <div className="border-t pt-2">
                  <div className={cn("text-center text-xl font-bold",
                    Math.abs(diff) < 0.01 ? "text-green-600" :
                    Math.abs(diff) < 5 ? "text-yellow-600" : "text-red-600"
                  )}>
                    {Math.abs(diff) < 0.01 ? "Perfect Match!" :
                      diff > 0 ? `$${diff.toFixed(2)} Over` : `$${Math.abs(diff).toFixed(2)} Short`}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="border-t p-4">
          <Button className="w-full h-12" onClick={() => submitRegisterDataMutation.mutate()}
            disabled={submitRegisterDataMutation.isPending}>
            {submitRegisterDataMutation.isPending ? "Saving..." : "Continue"}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "explanation") {
    const os = overShort();
    const quickReasons = [
      "Made change for customer",
      "Register discrepancy",
      "Counting error — small variance",
      "Unknown",
    ];

    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-center">Explain Discrepancy</h2>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className={cn("p-4 rounded-lg text-center", os < 0 ? "bg-red-50 dark:bg-red-900/20" : "bg-yellow-50 dark:bg-yellow-900/20")}>
            <p className="text-sm text-muted-foreground">Your drawer is</p>
            <p className="text-2xl font-bold text-red-600">
              ${Math.abs(os).toFixed(2)} {os < 0 ? "Short" : "Over"}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">Please explain why:</p>
          <div className="flex flex-wrap gap-2">
            {quickReasons.map(reason => (
              <Button key={reason} variant={explanation === reason ? "default" : "outline"} size="sm"
                onClick={() => setExplanation(reason)}>
                {reason}
              </Button>
            ))}
          </div>
          <Textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Add details..."
            rows={3}
          />
          <Button variant="outline" className="w-full" onClick={() => {
            setExplanation("");
            getRecountSuggestion();
            setPhase("recount");
          }}>
            Actually, let me recount
          </Button>
        </div>
        <div className="border-t p-4">
          <Button className="w-full h-12" onClick={() => submitExplanationMutation.mutate()}
            disabled={!explanation || submitExplanationMutation.isPending}>
            {submitExplanationMutation.isPending ? "Saving..." : "Submit Explanation"}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "complete") {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 gap-6">
        <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center animate-bounce">
          <i className="fas fa-check text-4xl text-green-600" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">All Done!</h3>
          <p className="text-muted-foreground">
            {sessionType === "opening"
              ? `${registerName} is open and ready to go.`
              : `${registerName} has been closed out successfully.`}
          </p>
          <p className="text-sm text-muted-foreground">
            Total counted: <span className="font-bold text-foreground">${runningTotal().toFixed(2)}</span>
          </p>
        </div>
        {sessionType === "closing" && (
          <Button variant="outline" size="lg" onClick={onComplete} className="gap-2">
            <i className="fas fa-university" /> Make Bank Deposit
          </Button>
        )}
        <Button size="lg" onClick={onComplete}>
          Done
        </Button>
      </div>
    );
  }

  return null;
}
