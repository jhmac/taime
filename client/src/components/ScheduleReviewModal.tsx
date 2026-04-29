import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Check, AlertTriangle, XCircle, Info,
  ShieldCheck, Users, DollarSign, Loader2,
} from 'lucide-react';

export interface ReviewIssue {
  type: string;
  date: string;
  shiftBlock: string;
  employees: string[];
  description: string;
  recommendation: string;
}

export interface ReviewResult {
  issues: ReviewIssue[];
  coverageAssessment: string;
  estimatedLaborCostPct: number | null;
  fairnessSummary: string;
  overallRating: 'pass' | 'warn' | 'fail';
}

const ratingConfig = {
  pass: {
    icon: <Check className="h-5 w-5" />,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
    label: 'Passed',
  },
  warn: {
    icon: <AlertTriangle className="h-5 w-5" />,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
    label: 'Warnings Found',
  },
  fail: {
    icon: <XCircle className="h-5 w-5" />,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
    label: 'Issues Found',
  },
};

export { ratingConfig };

interface ScheduleReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewResult: ReviewResult | null;
  activeEntriesCount: number;
  onApply: () => void;
  isApplying: boolean;
  applyButtonLabel?: string;
}

export default function ScheduleReviewModal({
  open,
  onOpenChange,
  reviewResult,
  activeEntriesCount,
  onApply,
  isApplying,
  applyButtonLabel = 'Apply Schedule Anyway',
}: ScheduleReviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Schedule Audit Report
          </DialogTitle>
        </DialogHeader>
        {reviewResult && (
          <div className="space-y-4">
            {/* Overall Rating */}
            <div className={`rounded-lg border p-4 ${ratingConfig[reviewResult.overallRating].bg}`}>
              <div className="flex items-center gap-2">
                <span className={ratingConfig[reviewResult.overallRating].color}>
                  {ratingConfig[reviewResult.overallRating].icon}
                </span>
                <span className={`font-semibold text-base ${ratingConfig[reviewResult.overallRating].color}`}>
                  Overall: {ratingConfig[reviewResult.overallRating].label}
                </span>
              </div>
            </div>

            {/* Coverage & Labor Cost */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Coverage Assessment
                </div>
                <p className="text-sm">{reviewResult.coverageAssessment || 'No assessment available.'}</p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" />
                  Estimated Labor Cost
                </div>
                <p className="text-sm">
                  {reviewResult.estimatedLaborCostPct !== null
                    ? `${reviewResult.estimatedLaborCostPct.toFixed(1)}% of projected revenue`
                    : 'Unable to estimate'}
                </p>
              </div>
            </div>

            {/* Fairness Summary */}
            {reviewResult.fairnessSummary && (
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  Fairness Assessment
                </div>
                <p className="text-sm">{reviewResult.fairnessSummary}</p>
              </div>
            )}

            {/* Issues List */}
            <div>
              <h3 className="text-sm font-semibold mb-2">
                {reviewResult.issues.length === 0
                  ? 'No issues found'
                  : `${reviewResult.issues.length} Issue${reviewResult.issues.length !== 1 ? 's' : ''} Found`}
              </h3>
              {reviewResult.issues.length === 0 ? (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-4 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0" />
                  This schedule looks good! No rule violations or coverage gaps were detected.
                </div>
              ) : (
                <div className="space-y-2">
                  {reviewResult.issues.map((issue, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {issue.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                          {issue.date && <span>{issue.date}</span>}
                          {issue.shiftBlock && <span>· {issue.shiftBlock}</span>}
                        </div>
                      </div>
                      {issue.employees && issue.employees.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {issue.employees.map((emp, j) => (
                            <Badge key={j} variant="secondary" className="text-xs">{emp}</Badge>
                          ))}
                        </div>
                      )}
                      <p className="text-sm">{issue.description}</p>
                      {issue.recommendation && (
                        <div className="rounded bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Fix: </span>
                          {issue.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                onClick={() => { onOpenChange(false); onApply(); }}
                disabled={isApplying || activeEntriesCount === 0}
                className="gap-2"
              >
                {isApplying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {applyButtonLabel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
