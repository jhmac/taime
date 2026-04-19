import { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorWithRetryProps {
  onRetry: () => void;
  message?: string;
  className?: string;
  isRetrying?: boolean;
  /**
   * When provided, shows a "Retrying in Xs…" countdown and automatically
   * calls onRetry when it reaches zero. Pass the query's failureCount (or
   * similar monotonic value) as the component's `key` so the countdown
   * resets correctly after each retry attempt.
   */
  retryIn?: number;
}

export default function ErrorWithRetry({
  onRetry,
  message = "Failed to load",
  className,
  isRetrying = false,
  retryIn,
}: ErrorWithRetryProps) {
  const [countdown, setCountdown] = useState<number | null>(
    retryIn != null && retryIn > 0 ? retryIn : null
  );
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    if (retryIn == null || retryIn <= 0) {
      setCountdown(null);
      return;
    }

    setCountdown(retryIn);

    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev == null || prev <= 1) {
          clearTimer();
          onRetryRef.current();
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return clearTimer;
  }, [retryIn]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3",
        className
      )}
    >
      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
      <p className="flex-1 text-sm text-muted-foreground">{message}</p>
      {countdown != null && (
        <span className="text-xs text-muted-foreground/70 tabular-nums whitespace-nowrap">
          Retrying in {countdown}s…
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          clearTimer();
          setCountdown(null);
          onRetry();
        }}
        disabled={isRetrying}
      >
        <RefreshCw className={cn("h-3 w-3", isRetrying && "animate-spin")} />
        Retry
      </Button>
    </div>
  );
}
