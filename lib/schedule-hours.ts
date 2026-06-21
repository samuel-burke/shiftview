// Pure helpers for proactively surfacing **scheduled** overtime — i.e. catching
// that a manager is about to schedule someone past 40 hours in a week, before
// any punches exist. This complements lib/payroll.ts, which computes overtime
// after the fact from actual worked time. Times are minutes since midnight.

// US convention: hours scheduled beyond 40/week are overtime. Stored in minutes
// (40 × 60) so it composes with the rest of the minute-based domain.
export const WEEKLY_OVERTIME_THRESHOLD_MINUTES = 40 * 60;

export type EmployeeShift = {
  employeeId: number;
  date: string; // YYYY-MM-DD (timestamp prefixes are tolerated)
  startMinutes: number;
  endMinutes: number;
};

export function shiftMinutes(s: { startMinutes: number; endMinutes: number }): number {
  return s.endMinutes - s.startMinutes;
}

// Total scheduled minutes per employee across the given set of dates (typically
// the 7 days of one week). Dates are compared on their YYYY-MM-DD prefix so a
// timestamptz column value works the same as a plain date string.
export function scheduledMinutesByEmployee(
  shifts: EmployeeShift[],
  dates: string[]
): Map<number, number> {
  const inWeek = new Set(dates.map((d) => d.slice(0, 10)));
  const totals = new Map<number, number>();
  for (const s of shifts) {
    if (!inWeek.has(s.date.slice(0, 10))) continue;
    totals.set(s.employeeId, (totals.get(s.employeeId) ?? 0) + shiftMinutes(s));
  }
  return totals;
}

export type EmployeeHours = {
  employeeId: number;
  totalMinutes: number;
  overtimeMinutes: number;
  isOvertime: boolean;
};

// Per-employee weekly hours with overtime flagged, sorted by total descending
// so the highest-risk employees surface first.
export function summarizeWeeklyHours(
  shifts: EmployeeShift[],
  dates: string[],
  threshold: number = WEEKLY_OVERTIME_THRESHOLD_MINUTES
): EmployeeHours[] {
  const totals = scheduledMinutesByEmployee(shifts, dates);
  const rows: EmployeeHours[] = [];
  for (const [employeeId, totalMinutes] of totals) {
    const overtimeMinutes = Math.max(0, totalMinutes - threshold);
    rows.push({ employeeId, totalMinutes, overtimeMinutes, isOvertime: overtimeMinutes > 0 });
  }
  rows.sort((a, b) => b.totalMinutes - a.totalMinutes || a.employeeId - b.employeeId);
  return rows;
}

// Whether adding `addedMinutes` to an employee already scheduled for
// `currentMinutes` this week would push them into overtime. Used to warn a
// manager at the moment they add or extend a shift.
export function wouldExceedThreshold(
  currentMinutes: number,
  addedMinutes: number,
  threshold: number = WEEKLY_OVERTIME_THRESHOLD_MINUTES
): boolean {
  return currentMinutes + addedMinutes > threshold;
}
