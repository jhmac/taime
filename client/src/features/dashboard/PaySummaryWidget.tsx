import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';
import ErrorWithRetry from '@/components/ErrorWithRetry';

interface PaySummary {
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  hourlyRate: number;
  grossPay: number;
  ficaDeduction: number;
  federalWithholding: number;
  stateWithholding: number;
  otherDeductions: number;
  totalDeductions: number;
  netPay: number;
  payScheduleFrequency: string;
}

function fmt(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtHours(h: number) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export default function PaySummaryWidget() {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<PaySummary>({
    queryKey: ['/api/users/me/pay-summary'],
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-3xl" />;
  }

  if (isError) {
    return <ErrorWithRetry onRetry={() => refetch()} message="Could not load pay summary" />;
  }

  if (!data) return null;

  const grossCents = Math.round(data.grossPay * 100);
  const netCents = Math.round(data.netPay * 100);
  const ficaCents = Math.round(data.ficaDeduction * 100);
  const fedCents = Math.round(data.federalWithholding * 100);
  const stateCents = Math.round(data.stateWithholding * 100);
  const otherCents = data.otherDeductions;
  const totalDeductCents = Math.round(data.totalDeductions * 100);

  const periodStart = new Date(data.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const periodEnd = new Date(data.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="rounded-3xl overflow-hidden bg-gradient-to-br from-[#F47D31] to-[#e06520] text-white shadow-sm">
      <button
        className="w-full text-left p-4"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-white/80 leading-none">Pay This Period</p>
              <p className="text-xs text-white/60 mt-0.5">{periodStart} – {periodEnd}</p>
            </div>
          </div>
          <div className="text-right flex items-center gap-2">
            <div>
              <p className="text-2xl font-bold leading-none">{fmt(netCents)}</p>
              <p className="text-xs text-white/70 mt-0.5">est. net pay</p>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-white/70 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/70 flex-shrink-0" />}
          </div>
        </div>

        <div className="flex gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-white/70" />
            <span className="text-xs text-white/80">{fmtHours(data.totalHours)} worked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-white/70" />
            <span className="text-xs text-white/80">{fmt(grossCents)} gross</span>
          </div>
        </div>
        <p className="text-[10px] text-white/55 mt-2 leading-snug">
          Approximate only — actual pay may vary.
        </p>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/20 pt-3 space-y-1.5">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-2">Estimated Deductions</p>
          {[
            { label: 'FICA (7.65%)', amount: ficaCents },
            { label: 'Federal Withholding', amount: fedCents },
            { label: 'State Withholding', amount: stateCents },
            ...(otherCents > 0 ? [{ label: 'Other Deductions', amount: otherCents }] : []),
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <span className="text-white/80 flex items-center gap-1">
                <Minus className="w-3 h-3 text-white/50" />
                {row.label}
              </span>
              <span className="text-white/90 font-medium">{fmt(row.amount)}</span>
            </div>
          ))}
          <div className="border-t border-white/20 pt-2 mt-2 flex justify-between text-sm font-semibold">
            <span>Total Deductions</span>
            <span>{fmt(totalDeductCents)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold mt-1">
            <span>Projected Net Pay</span>
            <span>{fmt(netCents)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
