import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, CheckCircle2, ArrowRight } from "lucide-react";

export default function WeeklyReviewCard() {
  const [, navigate] = useLocation();
  const now = new Date();
  const isFriday = now.getDay() === 5;
  const isAfter3pm = now.getHours() >= 15;

  const { data } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/gtd/review/current"],
    enabled: isFriday,
    staleTime: 5 * 60 * 1000,
  });

  if (!isFriday) return null;

  const review = data?.data;
  const isCompleted = review?.status === "completed";
  const isInProgress = review?.status === "in_progress";

  return (
    <Card className={isCompleted
      ? "border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/20"
      : "border-purple-200 dark:border-purple-800/50 bg-purple-50/50 dark:bg-purple-950/20"
    }>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
            isCompleted
              ? "bg-green-100 dark:bg-green-900/40"
              : "bg-purple-100 dark:bg-purple-900/40"
          }`}>
            {isCompleted
              ? <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              : <ClipboardCheck className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">Weekly Review</h3>
              {isCompleted && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 text-xs">Complete</Badge>}
              {isInProgress && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-xs">In Progress</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {isCompleted
                ? "You're organized and ready for next week!"
                : isAfter3pm
                  ? "Time for your weekly review!"
                  : "Your review will be ready at 3pm"
              }
            </p>
          </div>
          {!isCompleted && (
            <Button size="sm" variant="outline" onClick={() => navigate("/gtd/review")}>
              {isInProgress ? "Continue" : "Start"} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
