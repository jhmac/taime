// Payroll Intelligence — benchmark data, Profit First tiers, and shared types

export interface BenchmarkRange {
  min: number;
  max: number;
  ideal: number;
}

export interface Benchmark {
  label: string;
  description: string;
  payrollPct: BenchmarkRange;
  splh: BenchmarkRange;
  grossMargin: BenchmarkRange;
  avgTicket: BenchmarkRange;
  recommendation: string;
  sources: string[];
}

export const BENCHMARKS: Record<string, Benchmark> = {
  fashion_boutique: {
    label: 'Fashion Boutique – High Touch',
    description: 'Independent boutiques with personalized service, styling consultations, and curated inventory.',
    payrollPct: { min: 28, max: 35, ideal: 30 },
    splh: { min: 180, max: 280, ideal: 220 },
    grossMargin: { min: 48, max: 62, ideal: 55 },
    avgTicket: { min: 85, max: 160, ideal: 120 },
    recommendation: 'Target 28–35% payroll as a % of gross sales. Focus on SPLH over $200 by training staff on outfit add-ons and dressing-room conversions.',
    sources: ['Retail Owners Institute', 'SCORE Fashion Retail Benchmarks 2023', 'NRF Small Business Survey 2023'],
  },
  luxury: {
    label: 'Luxury / Contemporary',
    description: 'High-end boutiques with premium product lines, VIP service, and high average ticket values.',
    payrollPct: { min: 20, max: 28, ideal: 24 },
    splh: { min: 350, max: 650, ideal: 450 },
    grossMargin: { min: 55, max: 72, ideal: 65 },
    avgTicket: { min: 250, max: 600, ideal: 380 },
    recommendation: 'Luxury stores run leaner payroll (20–28%) because higher ticket values generate more revenue per labor hour. Invest your team\'s time in VIP relationship-building.',
    sources: ['Bain Luxury Study 2023', 'Retail Owners Institute Premium Segment', 'Deloitte Retail Benchmarks'],
  },
  general_retail: {
    label: 'General Retail / Multi-Category',
    description: 'Broader merchandise mix with moderate service levels and value-oriented pricing.',
    payrollPct: { min: 18, max: 28, ideal: 22 },
    splh: { min: 120, max: 200, ideal: 160 },
    grossMargin: { min: 35, max: 50, ideal: 42 },
    avgTicket: { min: 40, max: 90, ideal: 65 },
    recommendation: 'General retail competes on selection and price. Keep payroll below 28% and optimize floor coverage during peak traffic windows.',
    sources: ['NRF Annual Benchmark Report', 'Retail Owners Institute', 'IHL Group Retail Research'],
  },
  specialty_accessories: {
    label: 'Specialty / Accessories',
    description: 'Focused category stores (jewelry, handbags, shoes) with expert staff and moderate service intensity.',
    payrollPct: { min: 22, max: 32, ideal: 27 },
    splh: { min: 200, max: 350, ideal: 260 },
    grossMargin: { min: 50, max: 65, ideal: 58 },
    avgTicket: { min: 75, max: 220, ideal: 140 },
    recommendation: 'Specialty stores benefit from deep product knowledge. Each conversion is high-value, so train staff thoroughly and keep payroll 22–32%.',
    sources: ['Specialty Retail Association', 'Retail Owners Institute', 'SCORE Benchmarks 2023'],
  },
};

export interface PFTier {
  label: string;
  minAnnual: number;
  maxAnnual: number;
  profit: number;
  ownerPay: number;
  tax: number;
  opex: number;
}

export const PF_TIERS: PFTier[] = [
  { label: '$0–$250k / yr',     minAnnual: 0,       maxAnnual: 250000,  profit: 5,  ownerPay: 50, tax: 15, opex: 30 },
  { label: '$250k–$500k / yr',  minAnnual: 250000,  maxAnnual: 500000,  profit: 10, ownerPay: 35, tax: 15, opex: 40 },
  { label: '$500k–$1M / yr',    minAnnual: 500000,  maxAnnual: 1000000, profit: 15, ownerPay: 20, tax: 15, opex: 50 },
  { label: '$1M+ / yr',         minAnnual: 1000000, maxAnnual: Infinity, profit: 20, ownerPay: 10, tax: 15, opex: 55 },
];

// ── API response types ────────────────────────────────────────────────────────

export interface DailyBreakdownRow {
  date: string;
  revenue: number;
  laborCost: number;
  hours: number;
  laborPct: number;
  splh: number;
  orderCount: number;
}

export interface EmployeeRow {
  userId: string;
  name: string;
  totalHours: number;
  laborCost: number;
  wageRate: number;
  splh: number | null;
  roi: number | null;
}

export interface PayrollSettings {
  payrollTargetPct: number;
  storeType: string;
}

export interface PayrollSummary {
  shopConnected: boolean;
  shopName: string | null;
  settings: PayrollSettings;
  grossSales: number;
  totalHours: number;
  totalLaborCost: number;
  splh: number;
  avgTicket: number;
  laborPct: number;
  orderCount: number;
  daysBack: number;
  dailyBreakdown: DailyBreakdownRow[];
  employees: EmployeeRow[];
}
