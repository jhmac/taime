import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  BENCHMARKS,
  PF_TIERS,
  type PayrollSummary,
  type Benchmark,
  type PFTier,
} from '@/lib/payrollBenchmarks';

// ── Time range options ────────────────────────────────────────────────────────
const TIME_RANGES = [
  { label: '7d',  daysBack: 7  },
  { label: '14d', daysBack: 14 },
  { label: '30d', daysBack: 30 },
  { label: '90d', daysBack: 90 },
];

// ── Utility helpers ───────────────────────────────────────────────────────────
const fmt$ = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtHrs = (n: number) => `${n.toFixed(1)}h`;

function statusColor(actual: number, min: number, max: number, lower_is_better = false) {
  const ok = lower_is_better ? actual <= max : actual >= min && actual <= max;
  const warn = lower_is_better
    ? actual <= max * 1.15
    : actual >= min * 0.85 && actual <= max * 1.15;
  if (ok) return 'text-green-600 dark:text-green-400';
  if (warn) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

// ── RangeBar — segment-based, CSS-custom-property positioning ────────────────
function RangeBar({
  label,
  unit,
  actual,
  min,
  max,
  ideal,
  lowerIsBetter = false,
  format,
}: {
  label: string;
  unit?: string;
  actual: number | null;
  min: number;
  max: number;
  ideal: number;
  lowerIsBetter?: boolean;
  format?: (n: number) => string;
}) {
  const fmt = format ?? ((n: number) => `${n}${unit ?? ''}`);
  const barMin = min * 0.7;
  const barMax = max * 1.3;
  const range = barMax - barMin;

  const toPct = (v: number) => Math.min(100, Math.max(0, ((v - barMin) / range) * 100));

  const isGood = actual == null ? null
    : lowerIsBetter ? actual <= max
    : actual >= min && actual <= max;

  // Segment widths (sum to 100%) — no absolute positioning needed
  const w1 = toPct(min);
  const w2 = toPct(ideal) - toPct(min);
  const w3 = toPct(max) - toPct(ideal);
  const w4 = 100 - toPct(max);
  const actualPct = actual != null ? toPct(actual) : null;

  const markerColor =
    isGood === true  ? 'bg-green-500'  :
    isGood === false ? 'bg-red-500'    :
                       'bg-yellow-500';

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        {actual != null && (
          <span className={`font-bold ${isGood === true ? 'text-green-600 dark:text-green-400' : isGood === false ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
            {fmt(actual)} {isGood === true ? '✓' : isGood === false ? '↑' : '~'}
          </span>
        )}
      </div>
      {/* Segment bar — flex layout eliminates absolute left/width inline styles */}
      <div
        className="relative h-5 flex rounded-full overflow-hidden bg-muted"
        {...(actualPct != null ? { style: { '--actual-pct': `${actualPct}%` } as React.CSSProperties } : {})}
      >
        <div className="h-full bg-muted shrink-0"               style={{ width: `${w1}%` }} />
        <div className="h-full bg-green-500/20 shrink-0"        style={{ width: `${w2}%` }} />
        <div className="h-full bg-green-500/20 border-r-2 border-green-600/60 shrink-0" style={{ width: `${w3}%` }} />
        <div className="h-full bg-muted shrink-0"               style={{ width: `${w4}%` }} />
        {/* Actual value marker — positioned via CSS custom property */}
        {actualPct != null && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-background shadow-md z-10 ${markerColor}`}
            style={{ left: 'var(--actual-pct)' }}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
        <span>{fmt(min)}</span>
        <span className="text-green-600 dark:text-green-400">Ideal: {fmt(ideal)}</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
}

// ── GaugeArc ─────────────────────────────────────────────────────────────────
function GaugeArc({ pct, label, color }: { pct: number; label: string; color: string }) {
  const radius = 50;
  const circumference = Math.PI * radius; // half circle arc
  const dashArray = (pct / 100) * circumference;
  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="80" viewBox="0 0 120 65">
        <path
          d="M10,60 A50,50 0 0,1 110,60"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M10,60 A50,50 0 0,1 110,60"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dashArray} ${circumference}`}
        />
        <text x="60" y="56" textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor">
          {pct.toFixed(0)}%
        </text>
      </svg>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

// ── InsightCard ───────────────────────────────────────────────────────────────
function InsightCard({ icon, title, body, color = 'blue' }: {
  icon: string;
  title: string;
  body: string;
  color?: 'blue' | 'green' | 'orange' | 'red' | 'purple';
}) {
  const colors: Record<string, string> = {
    blue:   'border-l-blue-500   bg-blue-50   dark:bg-blue-950/20',
    green:  'border-l-green-500  bg-green-50  dark:bg-green-950/20',
    orange: 'border-l-orange-500 bg-orange-50 dark:bg-orange-950/20',
    red:    'border-l-red-500    bg-red-50    dark:bg-red-950/20',
    purple: 'border-l-purple-500 bg-purple-50 dark:bg-purple-950/20',
  };
  return (
    <div className={`border-l-4 rounded-r-lg p-4 ${colors[color]}`}>
      <div className="flex items-start gap-2">
        <i className={`${icon} mt-0.5 text-sm`} />
        <div>
          <p className="text-sm font-semibold mb-0.5">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

// ── BenchmarkTab ──────────────────────────────────────────────────────────────
function BenchmarkTab({
  summary,
  localStoreType,
  setLocalStoreType,
  localTarget,
  setLocalTarget,
  onSave,
  isSaving,
}: {
  summary: PayrollSummary | null;
  localStoreType: string;
  setLocalStoreType: (v: string) => void;
  localTarget: number;
  setLocalTarget: (v: number) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const benchmark: Benchmark = BENCHMARKS[localStoreType] ?? BENCHMARKS.fashion_boutique;
  const [showSources, setShowSources] = useState(false);

  return (
    <div className="space-y-5">
      {/* Store type selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-store text-primary" />
            Store Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(BENCHMARKS).map(([key, b]) => (
              <button
                key={key}
                onClick={() => setLocalStoreType(key)}
                className={`text-left p-3 rounded-xl border-2 transition-colors ${
                  localStoreType === key
                    ? 'border-primary bg-primary/5'
                    : 'border-muted hover:border-primary/40'
                }`}
              >
                <p className="text-xs font-semibold leading-snug">{b.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{b.description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Range bars */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-ruler-horizontal text-primary" />
            Industry Benchmarks — {benchmark.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <RangeBar
            label="Payroll % of Sales"
            actual={summary?.laborPct ?? null}
            min={benchmark.payrollPct.min}
            max={benchmark.payrollPct.max}
            ideal={benchmark.payrollPct.ideal}
            lowerIsBetter={false}
            format={fmtPct}
          />
          <RangeBar
            label="Sales Per Labor Hour (SPLH)"
            actual={summary?.splh ?? null}
            min={benchmark.splh.min}
            max={benchmark.splh.max}
            ideal={benchmark.splh.ideal}
            format={fmt$}
          />
          <RangeBar
            label="Average Order Value"
            actual={summary?.avgTicket ?? null}
            min={benchmark.avgTicket.min}
            max={benchmark.avgTicket.max}
            ideal={benchmark.avgTicket.ideal}
            format={fmt$}
          />
          <RangeBar
            label="Gross Margin (estimate needed)"
            actual={null}
            min={benchmark.grossMargin.min}
            max={benchmark.grossMargin.max}
            ideal={benchmark.grossMargin.ideal}
            format={fmtPct}
          />
          <p className="text-[10px] text-muted-foreground leading-relaxed pt-2 border-t">
            Green band = benchmark range. Circle marker = your actual. Ideal line = center of excellence.
            {summary == null && ' Connect Shopify to see your actual performance vs benchmark.'}
          </p>
        </CardContent>
      </Card>

      {/* Recommendation */}
      <InsightCard
        icon="fas fa-lightbulb text-yellow-500"
        title="Expert Recommendation"
        body={benchmark.recommendation}
        color="orange"
      />

      {/* Payroll target setter */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-crosshairs text-primary" />
            Your Payroll Target
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Set a target payroll % to use as your personal benchmark across Dashboard and Team views.
            Benchmark ideal for your store type is <strong>{benchmark.payrollPct.ideal}%</strong>.
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setLocalTarget(Math.max(0, localTarget - 1))}
              className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center text-sm font-bold hover:bg-muted/80"
            >–</button>
            <div className="flex-1">
              <input
                type="range"
                min={10}
                max={60}
                value={localTarget}
                onChange={e => setLocalTarget(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>10%</span>
                <span className="font-bold text-primary text-sm">{localTarget}%</span>
                <span>60%</span>
              </div>
            </div>
            <button
              onClick={() => setLocalTarget(Math.min(60, localTarget + 1))}
              className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center text-sm font-bold hover:bg-muted/80"
            >+</button>
          </div>
          <Button className="w-full mt-4" onClick={onSave} disabled={isSaving}>
            {isSaving ? <><i className="fas fa-spinner fa-spin mr-2" />Saving…</> : <><i className="fas fa-save mr-2" />Save as My Target</>}
          </Button>
        </CardContent>
      </Card>

      {/* Sources */}
      <div>
        <button
          onClick={() => setShowSources(s => !s)}
          className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <i className={`fas fa-chevron-${showSources ? 'up' : 'down'} text-[10px]`} />
          {showSources ? 'Hide sources' : 'View benchmark sources'}
        </button>
        {showSources && (
          <ul className="mt-2 space-y-1 pl-4">
            {benchmark.sources.map((src, i) => (
              <li key={i} className="text-[10px] text-muted-foreground list-disc">{src}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── DashboardTab ──────────────────────────────────────────────────────────────
function DashboardTab({
  summary,
  daysBack,
  setDaysBack,
  isLoading,
  benchmark,
}: {
  summary: PayrollSummary | null;
  daysBack: number;
  setDaysBack: (v: number) => void;
  isLoading: boolean;
  benchmark: Benchmark;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>)}
        </div>
        <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!summary?.shopConnected) {
    return (
      <div className="text-center py-12">
        <i className="fab fa-shopify text-4xl text-muted-foreground mb-3" />
        <p className="font-semibold mb-1">Shopify Not Connected</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Connect your Shopify store in Settings → Shopify to unlock the Payroll Dashboard with live revenue vs labor data.
        </p>
      </div>
    );
  }

  const target = summary.settings.payrollTargetPct;
  const laborPct = summary.laborPct;
  const gauge = Math.min(100, (laborPct / (target * 2)) * 100);

  const gaugeColor = laborPct <= target
    ? '#22c55e'
    : laborPct <= target * 1.15
    ? '#eab308'
    : '#ef4444';

  const avgWage = summary.totalHours > 0 ? summary.totalLaborCost / summary.totalHours : 0;
  const optimalHours = avgWage > 0 ? (summary.grossSales * (target / 100)) / avgWage : 0;

  const kpis = [
    { label: 'Gross Sales',   value: fmt$(summary.grossSales),                                     icon: 'fas fa-dollar-sign', color: 'border-t-green-500'  },
    { label: 'Total Hours',   value: summary.totalHours > 0 ? fmtHrs(summary.totalHours) : '—',   icon: 'fas fa-clock',       color: 'border-t-blue-500'   },
    { label: 'SPLH',          value: summary.splh > 0 ? fmt$(summary.splh) : '—',                 icon: 'fas fa-bolt',        color: 'border-t-purple-500' },
    { label: 'Avg Ticket',    value: summary.avgTicket > 0 ? fmt$(summary.avgTicket) : '—',        icon: 'fas fa-receipt',     color: 'border-t-amber-500'  },
  ];

  const chartData = summary.dailyBreakdown.map(d => ({
    date: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    laborPct: d.laborPct,
    target,
  }));

  return (
    <div className="space-y-5">
      {/* Time range picker */}
      <div className="flex rounded-lg border bg-muted/30 p-1 gap-1 w-fit">
        {TIME_RANGES.map(r => (
          <button
            key={r.daysBack}
            onClick={() => setDaysBack(r.daysBack)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              daysBack === r.daysBack
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map(k => (
          <Card key={k.label} className={`border-t-4 ${k.color}`}>
            <CardContent className="p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k.label}</p>
              <p className="text-xl font-bold mt-1">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Payroll health gauge */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-tachometer-alt text-primary" />
              Payroll Health
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center pt-2">
            <GaugeArc pct={laborPct} label={`${laborPct.toFixed(1)}% of sales → target ${target}%`} color={gaugeColor} />
            <div className="mt-3 grid grid-cols-3 gap-2 w-full text-center">
              <div>
                <p className="text-xs font-bold">{fmtHrs(summary.totalHours)}</p>
                <p className="text-[10px] text-muted-foreground">Hours Worked</p>
              </div>
              <div>
                <p className="text-xs font-bold">{fmtHrs(optimalHours)}</p>
                <p className="text-[10px] text-muted-foreground">Optimal Hours</p>
              </div>
              <div>
                <p className={`text-xs font-bold ${summary.totalHours <= optimalHours ? 'text-green-600' : 'text-red-600'}`}>
                  {summary.totalHours <= optimalHours ? 'Under' : 'Over'} by {fmtHrs(Math.abs(summary.totalHours - optimalHours))}
                </p>
                <p className="text-[10px] text-muted-foreground">vs Target</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-chart-pie text-primary" />
              Period Summary ({daysBack}d)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {[
              { label: 'Gross Sales', val: fmt$(summary.grossSales), sub: `${summary.orderCount} orders` },
              { label: 'Labor Cost', val: fmt$(summary.totalLaborCost), sub: `${fmtHrs(summary.totalHours)} worked` },
              { label: 'Payroll %', val: fmtPct(laborPct), sub: `Target: ${target}%`, highlight: laborPct <= target ? 'green' : 'red' },
              { label: 'SPLH', val: summary.splh > 0 ? fmt$(summary.splh) : '—', sub: `Benchmark: ${fmt$(benchmark.splh.ideal)}` },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">{r.label}</p>
                  <p className="text-[10px] text-muted-foreground">{r.sub}</p>
                </div>
                <p className={`text-sm font-bold ${r.highlight === 'green' ? 'text-green-600' : r.highlight === 'red' ? 'text-red-600' : ''}`}>{r.val}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Daily payroll % bar chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <i className="fas fa-chart-bar text-primary" />
              Daily Payroll % vs Target
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number, name: string) => [
                  `${v.toFixed(1)}%`,
                  name === 'laborPct' ? 'Payroll %' : 'Target',
                ]} />
                <ReferenceLine y={target} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `${target}%`, position: 'right', fontSize: 10, fill: '#ef4444' }} />
                <Bar dataKey="laborPct" radius={[4,4,0,0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.laborPct <= target ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {(() => {
        // Weakest SPLH day — data-driven insight
        const daysWithSplh = summary.dailyBreakdown.filter(d => d.splh > 0 && d.hours > 0);
        const weakestDay = daysWithSplh.length > 0
          ? daysWithSplh.reduce((a, b) => a.splh < b.splh ? a : b)
          : null;
        const bestDay = daysWithSplh.length > 0
          ? daysWithSplh.reduce((a, b) => a.splh > b.splh ? a : b)
          : null;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InsightCard
              icon="fas fa-chart-line text-green-600"
              title={summary.splh >= benchmark.splh.ideal ? 'SPLH On Track' : 'SPLH Below Benchmark'}
              body={summary.splh >= benchmark.splh.ideal
                ? `Your SPLH of ${fmt$(summary.splh)} is at or above the ${benchmark.label} ideal of ${fmt$(benchmark.splh.ideal)}. Great work — maintain this with consistent add-on selling.`
                : `Your SPLH of ${fmt$(summary.splh)} is below the ${benchmark.label} ideal of ${fmt$(benchmark.splh.ideal)}. Focus on increasing transaction size through styling add-ons and accessories.`}
              color={summary.splh >= benchmark.splh.ideal ? 'green' : 'orange'}
            />
            <InsightCard
              icon="fas fa-users text-blue-600"
              title="Optimal Scheduling"
              body={`At your target payroll of ${target}%, you can afford ${fmtHrs(optimalHours)} of labor per ${daysBack} days at an avg wage of ${fmt$(avgWage)}/hr. You worked ${fmtHrs(summary.totalHours)} — ${summary.totalHours <= optimalHours ? `${fmtHrs(optimalHours - summary.totalHours)} of headroom remaining.` : `${fmtHrs(summary.totalHours - optimalHours)} over budget.`}`}
              color="blue"
            />
            {weakestDay && (
              <InsightCard
                icon="fas fa-exclamation-triangle text-red-500"
                title={`Weakest SPLH: ${new Date(weakestDay.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
                body={`${new Date(weakestDay.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })} was your lowest-SPLH day at ${fmt$(weakestDay.splh)}/hr (${fmtHrs(weakestDay.hours)} worked, ${fmt$(weakestDay.revenue)} sales). Review your schedule for that day — consider shifting hours toward your best-performing day (${fmt$(bestDay!.splh)}/hr).`}
                color="red"
              />
            )}
            {bestDay && bestDay !== weakestDay && (
              <InsightCard
                icon="fas fa-star text-amber-500"
                title={`Best SPLH: ${new Date(bestDay.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
                body={`${new Date(bestDay.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })} was your highest-SPLH day at ${fmt$(bestDay.splh)}/hr (${fmtHrs(bestDay.hours)} worked, ${fmt$(bestDay.revenue)} sales). Study what drove performance that day and replicate it.`}
                color="yellow"
              />
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── TeamTab ───────────────────────────────────────────────────────────────────
type TeamSortKey = 'totalHours' | 'laborCost' | 'wageRate' | 'splh';

function TeamTab({
  summary,
  isLoading,
}: {
  summary: PayrollSummary | null;
  isLoading: boolean;
}) {
  const [sortKey, setSortKey] = useState<TeamSortKey>('totalHours');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    if (!summary?.employees) return [];
    return [...summary.employees].sort((a, b) => {
      // SPLH is null for all employees — fall back to hours for tie-breaking
      const aVal = sortKey === 'splh' ? (a.splh ?? -1) : a[sortKey as Exclude<TeamSortKey, 'splh'>];
      const bVal = sortKey === 'splh' ? (b.splh ?? -1) : b[sortKey as Exclude<TeamSortKey, 'splh'>];
      const diff = (aVal as number) - (bVal as number);
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [summary, sortKey, sortDir]);

  const toggleSort = (key: TeamSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ k }: { k: TeamSortKey }) => {
    if (sortKey !== k) return <i className="fas fa-sort text-[10px] text-muted-foreground ml-1" />;
    return <i className={`fas fa-sort-${sortDir === 'desc' ? 'down' : 'up'} text-[10px] text-primary ml-1`} />;
  };

  if (isLoading) {
    return <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>;
  }

  if (!summary?.employees || summary.employees.length === 0) {
    return (
      <div className="text-center py-12">
        <i className="fas fa-users text-4xl text-muted-foreground mb-3" />
        <p className="font-semibold mb-1">No Team Data</p>
        <p className="text-sm text-muted-foreground">No completed clock-in/out entries found for this period.</p>
      </div>
    );
  }

  const totalCost = sorted.reduce((s, e) => s + e.laborCost, 0);
  const totalHours = sorted.reduce((s, e) => s + e.totalHours, 0);
  const avgHours = sorted.length > 0 ? totalHours / sorted.length : 0;

  // Performance badge: SPLH-first when available; fall back to hours vs avg
  const perfBadge = (emp: { totalHours: number; splh: number | null }) => {
    if (emp.splh !== null) {
      // SPLH-based: star = top quartile, coach = bottom quartile
      const allSplh = sorted.map(e => e.splh).filter((s): s is number => s !== null);
      if (allSplh.length > 1) {
        allSplh.sort((a, b) => a - b);
        const q1 = allSplh[Math.floor(allSplh.length * 0.25)];
        const q3 = allSplh[Math.floor(allSplh.length * 0.75)];
        if (emp.splh >= q3) return <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200 whitespace-nowrap">⭐ Star</Badge>;
        if (emp.splh <= q1) return <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 whitespace-nowrap">Coach</Badge>;
        return <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200 whitespace-nowrap">Solid</Badge>;
      }
    }
    // Hours-based fallback (used when SPLH is unavailable — Shopify store-wide only)
    const ratio = avgHours > 0 ? emp.totalHours / avgHours : 0;
    if (ratio >= 1.3) return <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200 whitespace-nowrap">Top Hours</Badge>;
    if (ratio >= 0.7) return <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200 whitespace-nowrap">On Track</Badge>;
    return <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 whitespace-nowrap">Low Hours</Badge>;
  };

  // Mentorship gap: highest wage + below-average hours = expensive and underutilized
  const mentorGap = sorted.length > 1
    ? [...sorted].sort((a, b) => b.wageRate - a.wageRate).find(e => e.totalHours < avgHours)
    : null;

  // Whether any employee has per-employee SPLH data (future: shift-level attribution)
  const hasSplhData = sorted.some(e => e.splh !== null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-users text-primary" />
            Team Labor Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('totalHours')}>
                    Hours <SortIcon k="totalHours" />
                  </TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('wageRate')}>
                    Rate <SortIcon k="wageRate" />
                  </TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('laborCost')}>
                    Cost <SortIcon k="laborCost" />
                  </TableHead>
                  <TableHead className="text-right text-muted-foreground">Sales</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('splh')}>
                    SPLH <SortIcon k="splh" />
                  </TableHead>
                  <TableHead className="text-right text-muted-foreground">ROI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(emp => {
                  const share = totalCost > 0 ? (emp.laborCost / totalCost) * 100 : 0;
                  return (
                    <TableRow key={emp.userId}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-sm">{emp.name}</span>
                          <div className="flex items-center gap-1">
                            {perfBadge(emp)}
                            <span className="text-[10px] text-muted-foreground">{share.toFixed(0)}% of payroll</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmtHrs(emp.totalHours)}</TableCell>
                      <TableCell className="text-right text-sm">${emp.wageRate.toFixed(2)}/h</TableCell>
                      <TableCell className="text-right text-sm font-semibold">{fmt$(emp.laborCost)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {emp.splh !== null ? fmt$(emp.splh * emp.totalHours) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {emp.splh !== null ? fmt$(emp.splh) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {emp.roi !== null ? `${emp.roi.toFixed(1)}×` : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {sorted.length > 0 && (
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell>Total ({sorted.length} employees)</TableCell>
                    <TableCell className="text-right">{fmtHrs(totalHours)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{fmt$(totalCost)}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {!hasSplhData && (
        <InsightCard
          icon="fas fa-info-circle text-blue-500"
          title="Sales, SPLH & ROI: Store-Level Only"
          body="Shopify reports sales store-wide, not per employee. Sales, SPLH, and ROI show '—' for each person. Performance badges use hours vs team average as a proxy. Future support for shift-level attribution via traffic counters will unlock individual SPLH."
          color="blue"
        />
      )}

      {mentorGap && (
        <InsightCard
          icon="fas fa-user-graduate text-orange-500"
          title={`Mentorship Opportunity: ${mentorGap.name}`}
          body={`${mentorGap.name} has your highest hourly rate ($${mentorGap.wageRate.toFixed(2)}/h) but worked below the team average of ${fmtHrs(avgHours)} this period (${fmtHrs(mentorGap.totalHours)} worked). Consider scheduling more high-value interactions — styling consults, VIP events — to maximize their contribution.`}
          color="orange"
        />
      )}

      {sorted.length > 0 && !mentorGap && (
        <InsightCard
          icon="fas fa-award text-purple-500"
          title={`Top Contributor: ${sorted[0]?.name}`}
          body={`${sorted[0]?.name} led the team in hours this period (${fmtHrs(sorted[0]?.totalHours ?? 0)}), accounting for ${totalCost > 0 ? ((sorted[0]?.laborCost / totalCost) * 100).toFixed(0) : 0}% of total labor spend. Consistent high-hour contributors are your scheduling backbone.`}
          color="purple"
        />
      )}
    </div>
  );
}

// ── ProfitFirstTab ────────────────────────────────────────────────────────────
function ProfitFirstTab({
  summary,
  isLoading,
  daysBack,
}: {
  summary: PayrollSummary | null;
  isLoading: boolean;
  daysBack: number;
}) {
  const [cogsPct, setCogsPct] = useState(45);

  if (isLoading) {
    return <Card><CardContent className="p-4"><Skeleton className="h-64 w-full" /></CardContent></Card>;
  }

  const grossSales = summary?.grossSales ?? 0;
  const annualized = daysBack > 0 ? (grossSales / daysBack) * 365 : 0;
  const realRevenue = grossSales * (1 - cogsPct / 100);
  const annualizedReal = realRevenue > 0 ? (realRevenue / daysBack) * 365 : 0;

  const tier: PFTier = PF_TIERS.find(t => annualizedReal >= t.minAnnual && annualizedReal < t.maxAnnual) ?? PF_TIERS[0];

  const allocs = [
    { label: 'Profit', pct: tier.profit, color: '#22c55e', icon: 'fas fa-piggy-bank' },
    { label: "Owner's Pay", pct: tier.ownerPay, color: '#3b82f6', icon: 'fas fa-user-tie' },
    { label: 'Tax Reserve', pct: tier.tax, color: '#f59e0b', icon: 'fas fa-file-invoice-dollar' },
    { label: 'Operating Expenses', pct: tier.opex, color: '#8b5cf6', icon: 'fas fa-cogs' },
  ];

  const periodAllocs = allocs.map(a => ({
    ...a,
    amount: realRevenue * (a.pct / 100),
  }));

  return (
    <div className="space-y-5">
      <InsightCard
        icon="fas fa-book text-green-600"
        title="What is Profit First?"
        body='Profit First (Mike Michalowicz) flips the formula from Sales − Expenses = Profit to Sales − Profit = Expenses. You allocate income to separate accounts immediately, making profit non-negotiable and forcing creative cost control.'
        color="green"
      />

      {/* COGS slider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-boxes text-primary" />
            Cost of Goods Sold (COGS)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Enter your estimated COGS % to compute <strong>Real Revenue</strong> (what flows to operating allocations).
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCogsPct(p => Math.max(0, p - 1))}
              className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center font-bold hover:bg-muted/80"
            >–</button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={80}
                value={cogsPct}
                onChange={e => setCogsPct(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>0%</span>
                <span className="font-bold text-primary text-sm">{cogsPct}% COGS</span>
                <span>80%</span>
              </div>
            </div>
            <button
              onClick={() => setCogsPct(p => Math.min(80, p + 1))}
              className="w-8 h-8 rounded-full border bg-muted flex items-center justify-center font-bold hover:bg-muted/80"
            >+</button>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-center">
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">Gross Sales</p>
              <p className="text-lg font-bold">{grossSales > 0 ? fmt$(grossSales) : '—'}</p>
              <p className="text-[10px] text-muted-foreground">{daysBack}d period</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">− COGS ({cogsPct}%)</p>
              <p className="text-lg font-bold text-red-600">{grossSales > 0 ? fmt$(grossSales * (cogsPct / 100)) : '—'}</p>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-xs text-muted-foreground">= Real Revenue</p>
              <p className="text-lg font-bold text-green-600">{grossSales > 0 ? fmt$(realRevenue) : '—'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Allocation rows */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-percentage text-primary" />
            Profit First Allocation — {tier.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {periodAllocs.map(a => (
            <div key={a.label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm">
                  <i className={`${a.icon} text-xs`} style={{ color: a.color }} />
                  <span className="font-medium">{a.label}</span>
                  <Badge variant="outline" className="text-[10px]">{a.pct}%</Badge>
                </div>
                <span className="text-sm font-bold">{grossSales > 0 ? fmt$(a.amount) : '—'}</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${a.pct}%`, backgroundColor: a.color }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Reference tier table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <i className="fas fa-table text-primary" />
            TAP (Target Allocation Percentages) Reference
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Annual Real Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Owner Pay</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">OpEx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PF_TIERS.map(t => (
                  <TableRow key={t.label} className={t.label === tier.label ? 'bg-primary/5 font-semibold' : ''}>
                    <TableCell className="text-xs">
                      {t.label === tier.label && <i className="fas fa-arrow-right text-primary mr-1 text-[10px]" />}
                      {t.label}
                    </TableCell>
                    <TableCell className="text-right text-xs text-green-600">{t.profit}%</TableCell>
                    <TableCell className="text-right text-xs text-blue-600">{t.ownerPay}%</TableCell>
                    <TableCell className="text-right text-xs text-amber-600">{t.tax}%</TableCell>
                    <TableCell className="text-right text-xs text-purple-600">{t.opex}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[10px] text-muted-foreground p-3 pt-2 border-t">
            Source: <em>Profit First</em> by Mike Michalowicz — TAP table for Instant Assessment.
            Your current tier is based on annualized real revenue: <strong>{annualizedReal > 0 ? fmt$(annualizedReal) : '—'}/yr</strong>.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InsightCard
          icon="fas fa-piggy-bank text-green-500"
          title="Lock In Profit First"
          body={`At your tier (${tier.label}), take ${tier.profit}% of every deposit as profit immediately. Even if it's ${grossSales > 0 ? fmt$(realRevenue * (tier.profit / 100)) : 'a small amount'} this period — the discipline compounds over time.`}
          color="green"
        />
        <InsightCard
          icon="fas fa-exclamation-circle text-orange-500"
          title="OpEx Budget Check"
          body={`Your Profit First OpEx budget is ${tier.opex}% of real revenue — ${grossSales > 0 ? fmt$(realRevenue * (tier.opex / 100)) : '—'} this period. Your labor cost of ${summary ? fmt$(summary.totalLaborCost) : '—'} should fit within this envelope.`}
          color="orange"
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const TABS = [
  { key: 'benchmark',    label: 'Benchmark',    icon: 'fas fa-ruler-horizontal' },
  { key: 'dashboard',   label: 'Dashboard',    icon: 'fas fa-tachometer-alt'  },
  { key: 'team',        label: 'Team',         icon: 'fas fa-users'           },
  { key: 'profit-first', label: 'Profit First', icon: 'fas fa-piggy-bank'     },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function PayrollIntelligence() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('benchmark');
  const [daysBack, setDaysBack] = useState(7);

  // Local state mirrors saved settings (pre-populated from API)
  const [localStoreType, setLocalStoreType] = useState('fashion_boutique');
  const [localTarget, setLocalTarget] = useState(30);
  const [settingsInitialized, setSettingsInitialized] = useState(false);

  // Fetch settings independently so controls are seeded immediately on mount
  const { data: savedSettings } = useQuery<PayrollSettings>({
    queryKey: ['/api/payroll-intelligence/settings'],
    queryFn: async () => {
      const res = await fetch('/api/payroll-intelligence/settings', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch payroll settings');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: summary, isLoading } = useQuery<PayrollSummary>({
    queryKey: ['/api/payroll-intelligence/summary', daysBack],
    queryFn: async () => {
      const res = await fetch(`/api/payroll-intelligence/summary?daysBack=${daysBack}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch payroll summary');
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  // Seed local controls from dedicated settings endpoint (once)
  if (savedSettings && !settingsInitialized) {
    setLocalStoreType(savedSettings.storeType);
    setLocalTarget(savedSettings.payrollTargetPct);
    setSettingsInitialized(true);
  }

  const saveSettings = useMutation({
    mutationFn: async () => {
      await apiRequest('PATCH', '/api/payroll-intelligence/settings', {
        payrollTargetPct: localTarget,
        storeType: localStoreType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payroll-intelligence/summary'] });
      queryClient.invalidateQueries({ queryKey: ['/api/payroll-intelligence/settings'] });
      toast({ title: 'Settings saved', description: 'Your payroll target and store type have been updated.' });
      setActiveTab('dashboard');
    },
    onError: () => {
      toast({ title: 'Save failed', description: 'Could not save settings. Please try again.', variant: 'destructive' });
    },
  });

  const benchmark = BENCHMARKS[localStoreType] ?? BENCHMARKS.fashion_boutique;

  // Merge saved settings with local overrides for live preview
  const summaryWithLocal: PayrollSummary | null = summary
    ? { ...summary, settings: { payrollTargetPct: localTarget, storeType: localStoreType } }
    : null;

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-xl font-bold">Payroll Intelligence</h1>
            <p className="text-sm opacity-80">Benchmarks · Labor health · Profit First</p>
          </div>
          {summary?.shopConnected && (
            <div className="flex items-center gap-1.5 text-xs bg-white/15 rounded-lg px-3 py-1.5">
              <i className="fab fa-shopify" />
              <span>Shopify Connected</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 rounded-lg bg-white/10 p-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white/30 text-white shadow-sm'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <i className={`${tab.icon} text-[10px]`} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="px-4 py-4 md:px-6 md:py-5 space-y-4">
        {activeTab === 'benchmark' && (
          <BenchmarkTab
            summary={summaryWithLocal}
            localStoreType={localStoreType}
            setLocalStoreType={setLocalStoreType}
            localTarget={localTarget}
            setLocalTarget={setLocalTarget}
            onSave={() => saveSettings.mutate()}
            isSaving={saveSettings.isPending}
          />
        )}
        {activeTab === 'dashboard' && (
          <DashboardTab
            summary={summaryWithLocal}
            daysBack={daysBack}
            setDaysBack={setDaysBack}
            isLoading={isLoading}
            benchmark={benchmark}
          />
        )}
        {activeTab === 'team' && (
          <TeamTab
            summary={summaryWithLocal}
            isLoading={isLoading}
          />
        )}
        {activeTab === 'profit-first' && (
          <ProfitFirstTab
            summary={summaryWithLocal}
            isLoading={isLoading}
            daysBack={daysBack}
          />
        )}
      </div>
    </div>
  );
}
