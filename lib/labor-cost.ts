import { zonedTimeToUtc } from "@/lib/dates";
import { apportion, type RateLookup } from "@/lib/pay-rates";
import { splitAtMidnights } from "@/lib/pay-cost";

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

// ─── Scheduled cost per day, at the rate in effect ───────────────────────────
//
// The week's scheduled shifts priced at the rate in effect on each hour's
// store-local date, in the shift's position (lib/pay-rates.ts has the rule):
// an overnight shift into a raise's first day is costed at the new rate after
// midnight. The minutes past the weekly threshold, in time order, are
// overtime. An employee's week cost is rounded to the cent once (so with one
// rate all week it is exactly computeLaborCost's figure), and split across
// the days the shifts are on so the days add up to it.


export type ScheduledShift = {
  employeeId: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
  positionId?: number | null;
};

export type ScheduledEmployeeCost = {
  employeeId: number;
  totalMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  // null when none of the hours has a rate.
  cost: number | null;
  // Some hours have no rate (they add nothing to cost).
  missingRate: boolean;
  // Cost by the date each shift is on (every date in `dates`).
  days: Record<string, number>;
};

export function scheduledCostByDay(
  shifts: ScheduledShift[],
  dates: string[],
  rates: RateLookup,
  tz: string,
  opts: { threshold?: number; otMultiplier?: number } = {},
): ScheduledEmployeeCost[] {
  const thresholdMs = (opts.threshold ?? WEEKLY_OVERTIME_THRESHOLD_MINUTES) * 60_000;
  const otMultiplier = opts.otMultiplier ?? OVERTIME_MULTIPLIER;
  const inWeek = new Set(dates);
  const byEmployee = new Map<number, ScheduledShift[]>();
  for (const s of shifts) {
    const date = s.date.slice(0, 10);
    if (!inWeek.has(date)) continue;
    if (!byEmployee.has(s.employeeId)) byEmployee.set(s.employeeId, []);
    byEmployee.get(s.employeeId)!.push({ ...s, date });
  }

  const out: ScheduledEmployeeCost[] = [];
  for (const [employeeId, list] of byEmployee) {
    const pieces = list
      .flatMap((s) =>
        splitAtMidnights(
          {
            start: zonedTimeToUtc(s.date, s.startMinutes, tz).getTime(),
            end: zonedTimeToUtc(s.date, s.endMinutes, tz).getTime(),
            scheduleId: null,
          },
          tz,
        ).map((p) => ({ ...p, shiftDate: s.date, positionId: s.positionId ?? null })),
      )
      .sort((a, b) => a.start - b.start);

    let elapsed = 0;
    let cost = 0;
    let rated = false;
    let missingRate = false;
    const dayCost: Record<string, number> = {};
    for (const p of pieces) {
      const len = p.end - p.start;
      const regular = Math.max(0, Math.min(len, thresholdMs - elapsed));
      const overtime = len - regular;
      elapsed += len;
      const { rate } = rates(employeeId, p.day, p.positionId);
      if (rate == null) { missingRate = true; continue; }
      rated = true;
      const c = (regular / 3_600_000) * rate + (overtime / 3_600_000) * rate * otMultiplier;
      cost += c;
      dayCost[p.shiftDate] = (dayCost[p.shiftDate] ?? 0) + c;
    }
    const totalMinutes = Math.round(elapsed / 60_000);
    const weekCost = rated ? round2(cost) : null;
    const cents = weekCost == null ? dates.map(() => 0) : apportion(Math.round(weekCost * 100), dates.map((d) => dayCost[d] ?? 0));
    out.push({
      employeeId,
      totalMinutes,
      regularMinutes: Math.min(totalMinutes, thresholdMs / 60_000),
      overtimeMinutes: Math.max(0, totalMinutes - thresholdMs / 60_000),
      cost: weekCost,
      missingRate,
      days: Object.fromEntries(dates.map((d, i) => [d, cents[i] / 100])),
    });
  }
  return out;
}
