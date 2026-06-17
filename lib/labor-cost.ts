// Pure scheduled labor-cost math, layered on the weekly-hours domain
// (lib/schedule-hours.ts). Cost = regular hours × rate + overtime hours × rate ×
// 1.5, where overtime is scheduled time beyond 40h/week. Rates are dollars/hour;
// a null rate means "not set" and yields a null cost (surfaced, not treated as
// $0). All money is rounded to cents.

// Scheduled time beyond 40h/week is overtime (US convention), in minutes.
export const WEEKLY_OVERTIME_THRESHOLD_MINUTES = 40 * 60;
export const OVERTIME_MULTIPLIER = 1.5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type LaborCostInput = {
  totalMinutes: number;
  payRate: number | null;
};

export type LaborCostResult = {
  regularMinutes: number;
  overtimeMinutes: number;
  cost: number | null;
};

export function computeLaborCost(
  input: LaborCostInput,
  opts: { threshold?: number; otMultiplier?: number } = {}
): LaborCostResult {
  const threshold = opts.threshold ?? WEEKLY_OVERTIME_THRESHOLD_MINUTES;
  const otMultiplier = opts.otMultiplier ?? OVERTIME_MULTIPLIER;

  const regularMinutes = Math.min(input.totalMinutes, threshold);
  const overtimeMinutes = Math.max(0, input.totalMinutes - threshold);

  if (input.payRate == null) {
    return { regularMinutes, overtimeMinutes, cost: null };
  }

  const cost =
    (regularMinutes / 60) * input.payRate +
    (overtimeMinutes / 60) * input.payRate * otMultiplier;

  return { regularMinutes, overtimeMinutes, cost: round2(cost) };
}

export type EmployeeCostInput = {
  employeeId: number;
  totalMinutes: number;
  payRate: number | null;
};

export type EmployeeCostRow = {
  employeeId: number;
  totalMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  cost: number | null;
};

export type WeeklyCostSummary = {
  rows: EmployeeCostRow[];
  totalCost: number;
  employeesMissingRate: number;
};

// Per-employee cost rows plus the week total. Rows are sorted by cost desc with
// unknown-rate employees last; `employeesMissingRate` counts scheduled
// employees whose rate isn't set (so the UI can prompt to fill them in).
export function summarizeWeeklyCost(
  employees: EmployeeCostInput[],
  opts: { threshold?: number; otMultiplier?: number } = {}
): WeeklyCostSummary {
  const rows: EmployeeCostRow[] = employees.map((e) => {
    const { regularMinutes, overtimeMinutes, cost } = computeLaborCost(e, opts);
    return { employeeId: e.employeeId, totalMinutes: e.totalMinutes, regularMinutes, overtimeMinutes, cost };
  });

  rows.sort((a, b) => {
    if (a.cost == null && b.cost == null) return a.employeeId - b.employeeId;
    if (a.cost == null) return 1;
    if (b.cost == null) return -1;
    return b.cost - a.cost || a.employeeId - b.employeeId;
  });

  const totalCost = round2(
    rows.reduce((sum, r) => sum + (r.cost ?? 0), 0)
  );
  const employeesMissingRate = rows.filter(
    (r) => r.cost == null && r.totalMinutes > 0
  ).length;

  return { rows, totalCost, employeesMissingRate };
}
