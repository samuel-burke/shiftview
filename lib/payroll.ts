import { addDaysToKey, dayOfWeekForKey, DEFAULT_TIMEZONE, localDayBoundsUtc, weekStartForKey } from "@/lib/dates";
import { assignPunchDays } from "@/lib/punch-sessions";

export type PunchRow = {
  id: number;
  employee_id: number;
  punch_type: string;
  punched_at: string;
  // On a break_start: the break is paid (a paid break type, migration 0065)
  // and counts as worked time instead of being deducted.
  break_paid?: boolean | null;
  employees: { name: string } | null;
};

// Hours past this in one workweek are overtime (FLSA weekly rule).
export const WEEKLY_OVERTIME_THRESHOLD_HOURS = 40;
// Workweeks, which overtime is measured over, start on Monday.
export const WORKWEEK_START_DAY = 1;

export type PayrollDay = {
  date: string;
  dayName: string;
  workedHours: number;
  // The day's worked hours split at the weekly threshold, counting every hour
  // worked earlier in the same workweek (even before the report's range).
  regularHours: number;
  overtimeHours: number;
  breakHours: number;
  // The day's punches don't pair up (an open shift, or a missing or doubled
  // punch): its hours need a manager's review before they're paid.
  hasIncomplete: boolean;
};

export type PayrollWeek = {
  weekStart: string;
  // Hours worked in this workweek before the report's range began. They are
  // paid in the previous period but count toward this week's overtime.
  priorHours: number;
  regularHours: number;
  overtimeHours: number;
  breakHours: number;
  totalWorkedHours: number;
  hasIncomplete: boolean;
  days: PayrollDay[];
};

export type EmployeePayroll = {
  employeeId: number;
  employeeName: string;
  weeks: PayrollWeek[];
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalBreakHours: number;
  totalWorkedHours: number;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_MS = 3_600_000;
const THRESHOLD_MS = WEEKLY_OVERTIME_THRESHOLD_HOURS * HOUR_MS;

// Hours to two decimals. Totals are summed in exact milliseconds and rounded
// once, so rounding never accumulates across days.
function hours(ms: number): number {
  return Math.round(ms / 36_000) / 100;
}

function getWeekStart(dateStr: string): string {
  return weekStartForKey(dateStr, WORKWEEK_START_DAY);
}

function getDayName(dateStr: string): string {
  return DAY_NAMES[dayOfWeekForKey(dateStr)];
}

// The punch_records window a payroll report for [from, to] must read, in `tz`:
//   * from the day before `from`'s workweek starts, so a shift that began the
//     night before is seen whole (and its post-midnight punches aren't taken
//     for a new shift), and so earlier days of a workweek the range starts
//     part-way through count toward its overtime;
//   * to the end of the day after `to`, so a shift that runs past midnight on
//     `to` is included.
export function payrollQueryWindow(from: string, to: string, tz: string): { start: string; end: string } {
  return {
    start: localDayBoundsUtc(addDaysToKey(getWeekStart(from), -1), tz).start.toISOString(),
    end: localDayBoundsUtc(addDaysToKey(to, 1), tz).end.toISOString(),
  };
}

function computeSegments(punches: PunchRow[]): {
  workedMs: number;
  breakMs: number;
  hasIncomplete: boolean;
} {
  let workedMs = 0;
  let breakMs = 0;
  let segStart: number | null = null;
  let breakStart: number | null = null;
  // A paid break doesn't stop the work segment: its time is worked, not
  // deducted. Only unpaid breaks add to breakMs.
  let breakPaid = false;
  // A punch that doesn't follow from the one before it — a second clock-in, a
  // clock-out with no clock-in, a break end with no break start — means
  // punches are missing or doubled. Count what can be paired, and flag the day.
  let outOfSequence = false;
  const endBreak = (t: number) => {
    if (breakStart !== null && !breakPaid) breakMs += t - breakStart;
    breakStart = null;
    breakPaid = false;
  };

  for (const p of punches) {
    const t = new Date(p.punched_at).getTime();
    switch (p.punch_type) {
      case "clock_in":
        // A second clock-in keeps the first: the time between them was worked.
        if (segStart !== null || breakStart !== null) outOfSequence = true;
        endBreak(t);
        if (segStart === null) segStart = t;
        break;
      case "break_end":
        if (breakStart === null) outOfSequence = true;
        endBreak(t);
        if (segStart === null) segStart = t;
        break;
      case "break_start":
        if (p.break_paid) {
          if (segStart === null || breakStart !== null) outOfSequence = true;
          if (breakStart === null && segStart !== null) { breakStart = t; breakPaid = true; }
          break;
        }
        if (segStart !== null) { workedMs += t - segStart; segStart = null; }
        else outOfSequence = true;
        if (breakStart === null) { breakStart = t; breakPaid = false; }
        break;
      case "clock_out":
        if (segStart === null && breakStart === null) outOfSequence = true;
        if (segStart !== null) { workedMs += t - segStart; segStart = null; }
        endBreak(t);
        break;
    }
  }

  return { workedMs, breakMs, hasIncomplete: outOfSequence || segStart !== null || breakStart !== null };
}

// Punches are bucketed into work days in `tz` — the org's timezone — with a
// shift that runs past midnight kept whole on the day it started. Overtime is
// measured per Monday–Sunday workweek and split by day in order: the hours of
// a day that take its week past 40 are overtime.
//
// With `range`, only days inside it are reported, but days earlier in the same
// workweek still count toward its overtime, so a range that starts mid-week
// (semi-monthly, or any period not on a Monday) loses none. Rows must cover
// payrollQueryWindow(range).
export function computePayroll(
  rows: PunchRow[],
  tz: string = DEFAULT_TIMEZONE,
  range?: { from: string; to: string },
): EmployeePayroll[] {
  const byEmployee: Record<number, { name: string; punches: PunchRow[] }> = {};
  for (const r of rows) {
    const name = (r.employees as { name: string } | null)?.name ?? `Employee ${r.employee_id}`;
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = { name, punches: [] };
    byEmployee[r.employee_id].punches.push(r);
  }

  // Days before this are only there to place the punches after them.
  const firstCountedDay = range ? getWeekStart(range.from) : null;

  return Object.entries(byEmployee)
    .map(([id, { name, punches }]) => {
      // Ties (two punches stamped the same instant) keep insertion order.
      const sorted = [...punches].sort(
        (a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime() || a.id - b.id
      );

      const byDate: Record<string, PunchRow[]> = {};
      const assigned = assignPunchDays(
        sorted.map((p) => ({ punchType: p.punch_type, punchedAt: p.punched_at })),
        tz,
      );
      sorted.forEach((p, i) => {
        const date = assigned[i].day;
        if (firstCountedDay && date < firstCountedDay) return;
        if (range && date > range.to) return;
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(p);
      });

      const byWeek: Record<string, string[]> = {};
      for (const date of Object.keys(byDate)) {
        const ws = getWeekStart(date);
        if (!byWeek[ws]) byWeek[ws] = [];
        byWeek[ws].push(date);
      }

      let totalRegularMs = 0;
      let totalOvertimeMs = 0;
      let totalBreakMs = 0;

      const weeks: PayrollWeek[] = Object.entries(byWeek)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ws, dates]) => {
          let weekMs = 0; // every hour worked so far this workweek
          let priorMs = 0;
          let regularMs = 0;
          let overtimeMs = 0;
          let breakMs = 0;
          const days: PayrollDay[] = [];

          for (const date of dates.sort()) {
            const seg = computeSegments(byDate[date]);
            const dayRegularMs = Math.min(seg.workedMs, Math.max(0, THRESHOLD_MS - weekMs));
            const dayOvertimeMs = seg.workedMs - dayRegularMs;
            weekMs += seg.workedMs;
            if (range && date < range.from) {
              priorMs += seg.workedMs;
              continue;
            }
            regularMs += dayRegularMs;
            overtimeMs += dayOvertimeMs;
            breakMs += seg.breakMs;
            const workedHours = hours(seg.workedMs);
            const overtimeHours = hours(dayOvertimeMs);
            days.push({
              date,
              dayName: getDayName(date),
              workedHours,
              regularHours: Math.round((workedHours - overtimeHours) * 100) / 100,
              overtimeHours,
              breakHours: hours(seg.breakMs),
              hasIncomplete: seg.hasIncomplete,
            });
          }

          totalRegularMs += regularMs;
          totalOvertimeMs += overtimeMs;
          totalBreakMs += breakMs;
          const totalWorkedHours = hours(regularMs + overtimeMs);
          const overtimeHours = hours(overtimeMs);
          return {
            weekStart: ws,
            priorHours: hours(priorMs),
            regularHours: Math.round((totalWorkedHours - overtimeHours) * 100) / 100,
            overtimeHours,
            breakHours: hours(breakMs),
            totalWorkedHours,
            hasIncomplete: days.some((d) => d.hasIncomplete),
            days,
          };
        })
        .filter((w) => w.days.length > 0);

      const totalWorkedHours = hours(totalRegularMs + totalOvertimeMs);
      const totalOvertimeHours = hours(totalOvertimeMs);
      return {
        employeeId: Number(id),
        employeeName: name,
        weeks,
        totalRegularHours: Math.round((totalWorkedHours - totalOvertimeHours) * 100) / 100,
        totalOvertimeHours,
        totalBreakHours: hours(totalBreakMs),
        totalWorkedHours,
      };
    })
    .filter((e) => e.weeks.length > 0)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
