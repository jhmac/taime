import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, ChevronRight, CheckCircle2 } from "lucide-react";
import ErrorWithRetry from "@/components/ErrorWithRetry";
import { useOnlineRetry } from "@/hooks/useOnlineRetry";

interface RevisionStats {
  pendingCount: number;
  affectedSOPs: number;
}

export default function SOPRevisionCard() {
  const [, navigate] = useLocation();

  const { data: stats, isLoading, isError, refetch } = useQuery<RevisionStats>({
    queryKey: ["/api/sops/revisions/stats"],
    staleTime: 5 * 60 * 1000,
  });

  useOnlineRetry(refetch, isError);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32 mt-2" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-4">
          <ErrorWithRetry onRetry={() => refetch()} message="Could not load SOP revisions" />
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.pendingCount === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="font-medium">SOP Evolution</span>
            <Badge variant="secondary" className="ml-auto text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Up to Date
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            No pending improvement suggestions for your SOPs.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="font-medium">SOP Improvements</span>
          </div>
          <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100">
            {stats.pendingCount} suggestion{stats.pendingCount !== 1 ? "s" : ""}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          MAinager has {stats.pendingCount} improvement suggestion{stats.pendingCount !== 1 ? "s" : ""} across {stats.affectedSOPs} SOP{stats.affectedSOPs !== 1 ? "s" : ""}.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full mt-2.5 gap-1 text-xs"
          onClick={() => navigate("/sops/revisions")}
        >
          Review Suggestions <ChevronRight className="h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );
}
