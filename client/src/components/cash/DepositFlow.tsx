import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DepositFlowProps {
  sessions: any[];
  sessionId?: string | null;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = "summary" | "photo" | "validating" | "invalid" | "analyzing" | "confirm" | "complete";

function compressImage(file: File, maxSizeKB: number = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width *= ratio;
          height *= ratio;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.8;
        let result = canvas.toDataURL("image/jpeg", quality);
        while (result.length > maxSizeKB * 1024 * 1.37 && quality > 0.1) {
          quality -= 0.1;
          result = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(result);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DepositFlow({ sessions, sessionId, onComplete, onCancel }: DepositFlowProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("summary");
  const [depositSlipPhoto, setDepositSlipPhoto] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ amount: number | null; confidence: string; analysis: string } | null>(null);
  const [actualAmount, setActualAmount] = useState("");
  const [depositId, setDepositId] = useState<string | null>(null);
  const [invalidReason, setInvalidReason] = useState<string>("");

  const relevantSessions = sessionId ? sessions.filter((s: any) => s.id === sessionId) : sessions;
  const expectedAmount = relevantSessions.reduce((sum: number, s: any) => {
    const counted = parseFloat(s.totalCashCounted || "0");
    const starting = parseFloat(s.startingCash || "200");
    return sum + Math.max(0, counted - starting);
  }, 0);

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so re-selecting same file works
    e.target.value = "";
    try {
      const compressed = await compressImage(file);
      setDepositSlipPhoto(compressed);
      setStep("validating");

      // Step 1: Validate it's actually a deposit slip
      let isValid = true;
      let validationReason = "";
      try {
        const valRes = await apiRequest("POST", "/api/cash/validate-deposit-slip", { imageBase64: compressed });
        const valData = await valRes.json();
        isValid = valData.valid;
        validationReason = valData.reason || "";
      } catch {
        // If validation call fails, proceed anyway
        isValid = true;
      }

      if (!isValid) {
        setInvalidReason(validationReason);
        setStep("invalid");
        return;
      }

      setStep("analyzing");
      await createAndAnalyze(compressed);
    } catch {
      toast({ title: "Error", description: "Failed to process photo", variant: "destructive" });
      setStep("photo");
    }
  };

  const createAndAnalyze = async (photo: string) => {
    try {
      let id = depositId;
      if (!id) {
        const createRes = await apiRequest("POST", "/api/cash/deposits", {
          expectedAmount: expectedAmount.toFixed(2),
          depositSlipPhoto: photo,
          ...(sessionId ? { drawerSessionId: sessionId } : {}),
        });
        const deposit = await createRes.json();
        id = deposit.id;
        setDepositId(id);
      }

      try {
        const analyzeRes = await apiRequest("POST", `/api/cash/deposits/${id}/analyze`);
        const data = await analyzeRes.json();

        setAiResult({
          amount: data.analysis?.extractedAmount || null,
          confidence: data.analysis?.confidence || "failed",
          analysis: data.analysis?.analysis || "Could not analyze",
        });

        if (data.analysis?.extractedAmount) {
          setActualAmount(String(data.analysis.extractedAmount));
        }
      } catch {
        setAiResult({ amount: null, confidence: "failed", analysis: "AI analysis unavailable. Please enter the amount manually." });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/cash/deposits"] });
      setStep("confirm");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to process deposit", variant: "destructive" });
      setStep("photo");
    }
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!depositId) {
        throw new Error("No deposit record found. Please try again.");
      }
      const discrepancy = parseFloat(actualAmount) - expectedAmount;
      const res = await apiRequest("PUT", `/api/cash/deposits/${depositId}/submit`, {
        actualAmount: parseFloat(actualAmount).toFixed(2),
        reviewNotes: `Actual: $${parseFloat(actualAmount).toFixed(2)}, Expected: $${expectedAmount.toFixed(2)}, Diff: $${discrepancy.toFixed(2)}`,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Submission failed" }));
        throw new Error(err.error || "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash/deposits"] });
      setStep("complete");
    },
    onError: (err: any) => {
      toast({ title: "Submission Failed", description: err.message || "Could not submit deposit. Please try again.", variant: "destructive" });
    },
  });

  const handleSubmitWithoutPhoto = async () => {
    if (!actualAmount) return;
    try {
      const discrepancy = parseFloat(actualAmount) - expectedAmount;
      let id = depositId;
      if (!id) {
        const createRes = await apiRequest("POST", "/api/cash/deposits", {
          expectedAmount: expectedAmount.toFixed(2),
          actualAmount: parseFloat(actualAmount).toFixed(2),
          ...(sessionId ? { drawerSessionId: sessionId } : {}),
        });
        const deposit = await createRes.json();
        id = deposit.id;
        setDepositId(id);
      }

      const res = await apiRequest("PUT", `/api/cash/deposits/${id}/submit`, {
        actualAmount: parseFloat(actualAmount).toFixed(2),
        reviewNotes: `Manual entry. Actual: $${parseFloat(actualAmount).toFixed(2)}, Expected: $${expectedAmount.toFixed(2)}, Diff: $${discrepancy.toFixed(2)}`,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Submission failed" }));
        throw new Error(err.error || "Submission failed");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/cash/deposits"] });
      setStep("complete");
    } catch (err: any) {
      toast({ title: "Submission Failed", description: err.message || "Could not submit deposit.", variant: "destructive" });
    }
  };

  if (step === "summary") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <h2 className="font-semibold text-lg">Bank Deposit</h2>
          <div />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <i className="fas fa-university text-3xl text-blue-600" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold">Cash to Deposit</h3>
            <p className="text-4xl font-bold text-primary">${expectedAmount.toFixed(2)}</p>
          </div>
          <Card className="w-full max-w-sm">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">From {sessions.length} register(s):</p>
              {sessions.map((s: any) => (
                <div key={s.id} className="flex justify-between text-sm">
                  <span>{s.registerName}</span>
                  <span className="font-medium">${Math.max(0, parseFloat(s.totalCashCounted || "0") - parseFloat(s.startingCash || "200")).toFixed(2)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Button size="lg" className="w-full max-w-sm h-14 text-lg" onClick={() => setStep("photo")}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  if (step === "photo") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <Button variant="ghost" size="sm" onClick={() => setStep("summary")}>Back</Button>
          <h2 className="font-semibold text-lg">Deposit Slip Photo</h2>
          <div />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="w-20 h-20 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <i className="fas fa-camera text-3xl text-purple-600" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold">Take a Photo</h3>
            <p className="text-muted-foreground">Photograph your bank deposit slip so AI can verify the amount.</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
          <Button size="lg" className="w-full max-w-sm h-14 gap-2" onClick={() => fileInputRef.current?.click()}>
            <i className="fas fa-camera" /> Capture Deposit Slip
          </Button>
          <Button variant="outline" size="lg" className="w-full max-w-sm h-12" onClick={() => {
            setStep("confirm");
            setAiResult(null);
            setDepositSlipPhoto(null);
          }}>
            Skip Photo — Enter Amount Manually
          </Button>
        </div>
      </div>
    );
  }

  if (step === "validating") {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 gap-6">
        <div className="w-24 h-24 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center animate-pulse">
          <i className="fas fa-search text-4xl text-blue-500" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-xl font-bold">Checking Photo...</h3>
          <p className="text-muted-foreground">AI is confirming this is a bank deposit slip.</p>
        </div>
      </div>
    );
  }

  if (step === "invalid") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <Button variant="ghost" size="sm" onClick={() => setStep("photo")}>Back</Button>
          <h2 className="font-semibold text-lg">Photo Rejected</h2>
          <div />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className="w-24 h-24 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <i className="fas fa-times-circle text-4xl text-red-500" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold text-red-600 dark:text-red-400">Not a Deposit Slip</h3>
            <p className="text-muted-foreground">{invalidReason || "The uploaded photo does not appear to be a bank deposit slip."}</p>
          </div>
          {depositSlipPhoto && (
            <div className="rounded-lg overflow-hidden border max-h-48 w-full max-w-sm">
              <img src={depositSlipPhoto} alt="Rejected photo" className="w-full object-contain opacity-60" />
            </div>
          )}
          <div className="w-full max-w-sm space-y-3">
            <Button size="lg" className="w-full h-14 gap-2" onClick={() => {
              setDepositSlipPhoto(null);
              setStep("photo");
            }}>
              <i className="fas fa-camera" /> Retake Photo
            </Button>
            <Button variant="outline" size="lg" className="w-full h-12" onClick={() => {
              setStep("confirm");
              setAiResult(null);
              setDepositSlipPhoto(null);
            }}>
              Skip Photo — Enter Amount Manually
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "analyzing") {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 gap-6">
        <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
          <i className="fas fa-brain text-4xl text-primary" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-xl font-bold">Analyzing Deposit Slip...</h3>
          <p className="text-muted-foreground">AI is reading your deposit slip to extract the amount.</p>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    const amt = parseFloat(actualAmount || "0");
    const diff = amt - expectedAmount;
    const isManualEntry = !depositSlipPhoto;

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <Button variant="ghost" size="sm" onClick={() => setStep("photo")}>Back</Button>
          <h2 className="font-semibold text-lg">Verify Amount</h2>
          <div />
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {aiResult && aiResult.confidence !== "failed" && (
            <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <i className="fas fa-robot text-purple-500" />
                  <span className="font-medium">AI Read Your Slip</span>
                  <Badge variant={aiResult.confidence === "high" ? "default" : "secondary"}>
                    {aiResult.confidence} confidence
                  </Badge>
                </div>
                {aiResult.amount != null && (
                  <p className="text-2xl font-bold">${aiResult.amount.toFixed(2)}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">{aiResult.analysis}</p>
              </CardContent>
            </Card>
          )}

          {depositSlipPhoto && (
            <div className="rounded-lg overflow-hidden border max-h-48">
              <img src={depositSlipPhoto} alt="Deposit slip" className="w-full object-contain" />
            </div>
          )}

          {isManualEntry && (
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20">
              <CardContent className="p-3 flex items-center gap-2">
                <i className="fas fa-info-circle text-amber-500" />
                <p className="text-sm text-amber-700 dark:text-amber-300">No photo attached. Enter the deposit amount from your slip.</p>
              </CardContent>
            </Card>
          )}

          <div>
            <label className="text-sm font-medium block mb-1">Deposit Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">$</span>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                className="pl-7 h-16 text-2xl"
                value={actualAmount}
                onChange={(e) => setActualAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {amt > 0 && (
            <Card className={cn("border-2",
              Math.abs(diff) < 0.01 ? "border-green-300" :
              Math.abs(diff) < 5 ? "border-yellow-300" : "border-red-300"
            )}>
              <CardContent className="p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Expected</span><span className="font-medium">${expectedAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Deposit</span><span className="font-medium">${amt.toFixed(2)}</span>
                </div>
                <div className="border-t pt-2">
                  <div className={cn("text-center text-xl font-bold",
                    Math.abs(diff) < 0.01 ? "text-green-600" :
                    Math.abs(diff) < 5 ? "text-yellow-600" : "text-red-600"
                  )}>
                    {Math.abs(diff) < 0.01 ? "Exact Match!" :
                      diff > 0 ? `$${diff.toFixed(2)} Over` : `$${Math.abs(diff).toFixed(2)} Short`}
                  </div>
                  {Math.abs(diff) >= 5 && (
                    <p className="text-xs text-center text-muted-foreground mt-1">Owner will be notified of this variance.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="border-t p-4">
          <Button
            className="w-full h-12 text-base font-semibold"
            onClick={() => {
              if (!actualAmount || parseFloat(actualAmount) <= 0) {
                toast({ title: "Amount Required", description: "Please enter the deposit amount.", variant: "destructive" });
                return;
              }
              if (depositId) {
                submitMutation.mutate();
              } else {
                handleSubmitWithoutPhoto();
              }
            }}
            disabled={!actualAmount || parseFloat(actualAmount) <= 0 || submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <><i className="fas fa-spinner fa-spin mr-2" /> Submitting...</>
            ) : (
              "Submit Deposit"
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (step === "complete") {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 gap-6">
        <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center animate-bounce">
          <i className="fas fa-check text-4xl text-green-600" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">Deposit Submitted!</h3>
          <p className="text-muted-foreground">Your deposit has been recorded and is awaiting owner review.</p>
          <p className="text-lg font-bold text-primary">${actualAmount}</p>
        </div>
        <Button size="lg" onClick={onComplete}>Done</Button>
      </div>
    );
  }

  return null;
}
