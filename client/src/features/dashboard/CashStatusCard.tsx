import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import ErrorWithRetry from "@/components/ErrorWithRetry";
import { useOnlineRetry } from "@/hooks/useOnlineRetry";

export default function CashStatusCard() {
  const [, navigate] = useLocation();
  const today = new Date().toISOString().split("T")[0];

  const { data: sessions = [], isLoading: sessionsLoading, isError: sessionsError, refetch: refetchSessions, failureCount: sessionsFailureCount } = useQuery({
    queryKey: ["/api/cash/sessions", today],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/cash/sessions?date=${today}`);
      return res.json();
    },
    retry: 1,
  });

  const { data: deposits = [] } = useQuery({
    queryKey: ["/api/cash/deposits", today],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/cash/deposits?date=${today}`);
      return res.json();
    },
    retry: 1,
  });

  const { data: settings } = useQuery<Record<string, any>>({ queryKey: ["/api/cash/settings"], retry: 1 });

  useOnlineRetry(refetchSessions, sessionsError);

  if (sessionsLoading) return <Skeleton className="h-32" />;
  if (sessionsError) {
    return (
      <Card>
        <CardContent className="p-4">
          <ErrorWithRetry
            key={sessionsFailureCount}
            onRetry={() => refetchSessions()}
            message="Could not load cash status"
            retryIn={30}
          />
        </CardContent>
      </Card>
    );
  }

  const registers = (settings?.registers as any[]) || [{ name: "Register 1" }];
  const openingSessions = sessions.filter((s: any) => s.sessionType === "opening" && s.status !== "pending");
  const closingSessions = sessions.filter((s: any) => s.sessionType === "closing" && s.status !== "pending");
  const hasDeposit = deposits.length > 0;

  const totalOverShort = sessions
    .filter((s: any) => s.overShortAmount)
    .reduce((sum: number, s: any) => sum + parseFloat(s.overShortAmount), 0);

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/cash")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <i className="fas fa-cash-register text-primary" />
            Cash Management
          </span>
          {Math.abs(totalOverShort) >= 5 && (
            <Badge variant="destructive" className="text-xs">
              ${Math.abs(totalOverShort).toFixed(2)} {totalOverShort < 0 ? "short" : "over"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center">
            <p className="text-muted-foreground">Opened</p>
            <p className={cn("font-bold text-lg",
              openingSessions.length >= registers.length ? "text-green-600" : "text-muted-foreground"
            )}>
              {openingSessions.length}/{registers.length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Closed</p>
            <p className={cn("font-bold text-lg",
              closingSessions.length >= registers.length ? "text-green-600" : "text-muted-foreground"
            )}>
              {closingSessions.length}/{registers.length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Deposit</p>
            <p className="font-bold text-lg">
              {hasDeposit ? <i className="fas fa-check text-green-500" /> : <span className="text-muted-foreground">--</span>}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full text-xs text-primary">
          View Details <i className="fas fa-chevron-right ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
