import { addDaysToKey, dateKeyInTz, dayOfWeekForKey, daysBetweenKeys, DEFAULT_TIMEZONE, localDayBoundsUtc, weekStartForKey } from "@/lib/dates";
import { assignPunchDays } from "@/lib/punch-sessions";
import {
  DEFAULT_PAY_RULES,
  hasDailyRules,
  overtimeThresholds,
  roundPunchTimes,
  type PayRules,
} from "@/lib/pay-rules";

export type PunchRow = {
  id: number;
  employee_id: number;
  punch_type: string;
  punched_at: string;
  employees: { name: string } | null;
};

// Hours past this in one workweek are overtime (FLSA weekly rule).
export const WEEKLY_OVERTIME_THRESHOLD_HOURS = 40;
// The default payroll workweek start (Monday). Orgs can choose another day
// (app_settings.payroll_week_start, lib/pay-rules.ts).
export const WORKWEEK_START_DAY = DEFAULT_PAY_RULES.workweekStartDay;

export type PayrollDay = {
  date: string;
  dayName: string;
  workedHours: number;
  // The day's worked hours split by the org's overtime rule (lib/pay-rules.ts),
  // counting every hour worked earlier in the same workweek (even before the
  // report's range). regular + overtime + doubleTime = worked.
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  // California: this is the 7th consecutive workday of the workweek, so every
  // hour of it is premium time.
  seventhConsecutiveDay: boolean;
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
  doubleTimeHours: number;
  breakHours: number;
  totalWorkedHours: number;
  hasIncomplete: boolean;
  days: PayrollDay[];
};

export type EmployeePayroll = {
  employeeId: number;
  employeeName: string;
  // Exempt (salaried) employees get no overtime: every hour is regular.
  exempt: boolean;
  weeks: PayrollWeek[];
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalDoubleTimeHours: number;
  totalBreakHours: number;
  totalWorkedHours: number;
};

export type PayrollOptions = {
  rules?: Partial<PayRules>;
  exemptEmployeeIds?: ReadonlySet<number>;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_MS = 3_600_000;

// Hours to two decimals. Totals are summed in exact milliseconds and rounded
// once, so rounding never accumulates across days.
function hours(ms: number): number {
  return Math.round(ms / 36_000) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Worked ms split three ways, as hours that add up to hours(worked): each
// boundary is rounded once (premium = ot + dt), so the parts can't overshoot.
function splitHours(regularMs: number, overtimeMs: number, doubleTimeMs: number) {
  const worked = hours(regularMs + overtimeMs + doubleTimeMs);
  const premium = hours(overtimeMs + doubleTimeMs);
  const doubleTime = hours(doubleTimeMs);
  return {
    workedHours: worked,
    regularHours: round2(worked - premium),
    overtimeHours: round2(premium - doubleTime),
    doubleTimeHours: doubleTime,
  };
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
export function payrollQueryWindow(
  from: string,
  to: string,
  tz: string,
  workweekStartDay: number = WORKWEEK_START_DAY,
): { start: string; end: string } {
  return {
    start: localDayBoundsUtc(addDaysToKey(weekStartForKey(from, workweekStartDay), -1), tz).start.toISOString(),
    end: localDayBoundsUtc(addDaysToKey(to, 1), tz).end.toISOString(),
  };
}

type Interval = { start: number; end: number };

// Worked and break intervals of one work day's punches (as rounded for pay).
function computeSegments(punches: { punchType: string; ms: number }[]): {
  worked: Interval[];
  breaks: Interval[];
  hasIncomplete: boolean;
} {
  const worked: Interval[] = [];
  const breaks: Interval[] = [];
  let segStart: number | null = null;
  let breakStart: number | null = null;
  // A punch that doesn't follow from the one before it — a second clock-in, a
  // clock-out with no clock-in, a break end with no break start — means
  // punches are missing or doubled. Count what can be paired, and flag the day.
  let outOfSequence = false;
  const closeBreak = (t: number) => {
    if (breakStart !== null) { breaks.push({ start: breakStart, end: t }); breakStart = null; }
  };
  const closeWork = (t: number) => {
    if (segStart !== null) { worked.push({ start: segStart, end: t }); segStart = null; }
  };

  for (const p of punches) {
    const t = p.ms;
    switch (p.punchType) {
      case "clock_in":
        // A second clock-in keeps the first: the time between them was worked.
        if (segStart !== null || breakStart !== null) outOfSequence = true;
        closeBreak(t);
        if (segStart === null) segStart = t;
        break;
      case "break_end":
        if (breakStart !== null) closeBreak(t);
        else outOfSequence = true;
        if (segStart === null) segStart = t;
        break;
      case "break_start":
        if (segStart !== null) closeWork(t);
        else outOfSequence = true;
        if (breakStart === null) breakStart = t;
        break;
      case "clock_out":
        if (segStart === null && breakStart === null) outOfSequence = true;
        closeWork(t);
        closeBreak(t);
        break;
    }
  }

  return { worked, breaks, hasIncomplete: outOfSequence || segStart !== null || breakStart !== null };
}

// An interval cut at each midnight in `tz` it spans, each piece with the
// calendar day it falls on. DST-safe: midnights come from the zone itself, so
// a 23- or 25-hour day is cut where its own midnight is.
function splitAtMidnights(iv: Interval, tz: string): { day: string; ms: number }[] {
  const out: { day: string; ms: number }[] = [];
  let start = iv.start;
  while (start < iv.end) {
    const day = dateKeyInTz(start, tz);
    const nextMidnight = localDayBoundsUtc(day, tz).end.getTime() + 1;
    const end = Math.min(iv.end, nextMidnight);
    out.push({ day, ms: end - start });
    start = end;
  }
  return out;
}

type DayTotals = { workedMs: number; breakMs: number; hasIncomplete: boolean };

// Punches are bucketed into work days in `tz` (the org's timezone), a shift
// running past midnight kept with the day it started. Worked time then counts
// in the workweek it was actually worked: a shift across the workweek start
// is cut at that midnight (store time) and its later hours go to the new
// week's first day. Under a rule with daily thresholds (California, Alaska,
// Colorado, Nevada with daily overtime), every shift is cut at each store
// midnight, so each calendar day's hours are measured against the daily
// limits. Under the federal rule a shift otherwise stays whole on its start
// day, as before.
//
// Overtime follows the org's rule (lib/pay-rules.ts) over workweeks starting
// on `rules.workweekStartDay`, split by day in order. Hours paid as daily
// overtime or double time don't count again toward the weekly 40.
//
// With `range`, only days inside it are reported, but days earlier in the same
// workweek still count toward its overtime, so a range that starts mid-week
// (semi-monthly, or any period not on a workweek start) loses none. Rows must
// cover payrollQueryWindow(range, workweekStartDay).
//
// With rounding on, clock-ins and clock-outs are rounded (lib/pay-rules.ts)
// before hours are measured; which day a punch belongs to uses its real time.
export function computePayroll(
  rows: PunchRow[],
  tz: string = DEFAULT_TIMEZONE,
  range?: { from: string; to: string },
  options: PayrollOptions = {},
): EmployeePayroll[] {
  const rules: PayRules = { ...DEFAULT_PAY_RULES, ...options.rules };
  const thresholds = overtimeThresholds(rules);
  const daily = hasDailyRules(thresholds);
  const dailyOtMs = thresholds.dailyOvertime === null ? null : thresholds.dailyOvertime * HOUR_MS;
  const dailyDtMs = thresholds.dailyDoubleTime === null ? null : thresholds.dailyDoubleTime * HOUR_MS;
  const weeklyMs = thresholds.weeklyOvertime * HOUR_MS;
  const exemptIds = options.exemptEmployeeIds ?? new Set<number>();
  const weekOf = (date: string) => weekStartForKey(date, rules.workweekStartDay);

  const byEmployee: Record<number, { name: string; punches: PunchRow[] }> = {};
  for (const r of rows) {
    const name = (r.employees as { name: string } | null)?.name ?? `Employee ${r.employee_id}`;
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = { name, punches: [] };
    byEmployee[r.employee_id].punches.push(r);
  }

  // Days before this are only there to place the punches after them.
  const firstCountedDay = range ? weekOf(range.from) : null;

  return Object.entries(byEmployee)
    .map(([id, { name, punches }]) => {
      const exempt = exemptIds.has(Number(id));
      // Ties (two punches stamped the same instant) keep insertion order.
      const sorted = [...punches].sort(
        (a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime() || a.id - b.id
      );
      const assigned = assignPunchDays(
        sorted.map((p) => ({ punchType: p.punch_type, punchedAt: p.punched_at })),
        tz,
      );
      const paidMs = roundPunchTimes(
        sorted.map((p) => ({ punchType: p.punch_type, ms: new Date(p.punched_at).getTime() })),
        rules.roundingMinutes,
        tz,
      );

      // Punches by the work day they belong to, in order.
      const buckets = new Map<string, { punchType: string; ms: number }[]>();
      sorted.forEach((p, i) => {
        const day = assigned[i].day;
        const list = buckets.get(day) ?? [];
        list.push({ punchType: p.punch_type, ms: paidMs[i] });
        buckets.set(day, list);
      });

      // Each bucket's time, cut at the boundaries above, onto the day it counts in.
      const byDate = new Map<string, DayTotals>();
      const totals = (date: string) => {
        let t = byDate.get(date);
        if (!t) { t = { workedMs: 0, breakMs: 0, hasIncomplete: false }; byDate.set(date, t); }
        return t;
      };
      const countedDay = (bucketDay: string, pieceDay: string) =>
        daily || weekOf(pieceDay) !== weekOf(bucketDay) ? pieceDay : bucketDay;

      for (const [bucketDay, list] of buckets) {
        const seg = computeSegments(list);
        const touched = new Set<string>([bucketDay]);
        totals(bucketDay);
        for (const iv of seg.worked) {
          for (const piece of splitAtMidnights(iv, tz)) {
            const day = countedDay(bucketDay, piece.day);
            totals(day).workedMs += piece.ms;
            touched.add(day);
          }
        }
        for (const iv of seg.breaks) {
          for (const piece of splitAtMidnights(iv, tz)) {
            const day = countedDay(bucketDay, piece.day);
            totals(day).breakMs += piece.ms;
            touched.add(day);
          }
        }
        if (seg.hasIncomplete) for (const d of touched) totals(d).hasIncomplete = true;
      }

      const byWeek = new Map<string, string[]>();
      for (const date of byDate.keys()) {
        if (firstCountedDay && date < firstCountedDay) continue;
        if (range && date > range.to) continue;
        const ws = weekOf(date);
        byWeek.set(ws, [...(byWeek.get(ws) ?? []), date]);
      }

      let totalRegularMs = 0;
      let totalOvertimeMs = 0;
      let totalDoubleMs = 0;
      let totalBreakMs = 0;

      const weeks: PayrollWeek[] = [...byWeek.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ws, dates]) => {
          let weekRegularMs = 0; // regular hours so far this workweek, toward the weekly limit
          let priorMs = 0;
          let regularMs = 0;
          let overtimeMs = 0;
          let doubleMs = 0;
          let breakMs = 0;
          const workedDays = new Set<number>(); // day index in the workweek
          const days: PayrollDay[] = [];

          for (const date of dates.sort()) {
            const t = byDate.get(date)!;
            const w = t.workedMs;
            const index = daysBetweenKeys(ws, date);
            const seventh =
              !exempt && thresholds.seventhDay && index === 6 && w > 0 &&
              [0, 1, 2, 3, 4, 5].every((i) => workedDays.has(i));
            if (w > 0) workedDays.add(index);

            let dayRegular: number;
            let dayOvertime: number;
            let dayDouble: number;
            if (exempt) {
              dayRegular = w; dayOvertime = 0; dayDouble = 0;
            } else if (seventh) {
              // California 7th consecutive day: first 8 h overtime, the rest double.
              dayRegular = 0;
              dayOvertime = Math.min(w, 8 * HOUR_MS);
              dayDouble = w - dayOvertime;
            } else {
              const dailyRegular = dailyOtMs === null ? w : Math.min(w, dailyOtMs);
              dayDouble = dailyDtMs === null ? 0 : Math.max(0, w - dailyDtMs);
              dayOvertime = w - dailyRegular - dayDouble;
              // Weekly rule on what's still regular, so no hour is counted twice.
              dayRegular = Math.min(dailyRegular, Math.max(0, weeklyMs - weekRegularMs));
              dayOvertime += dailyRegular - dayRegular;
              weekRegularMs += dayRegular;
            }

            if (range && date < range.from) {
              priorMs += w;
              continue;
            }
            regularMs += dayRegular;
            overtimeMs += dayOvertime;
            doubleMs += dayDouble;
            breakMs += t.breakMs;
            days.push({
              date,
              dayName: getDayName(date),
              ...splitHours(dayRegular, dayOvertime, dayDouble),
              seventhConsecutiveDay: seventh,
              breakHours: hours(t.breakMs),
              hasIncomplete: t.hasIncomplete,
            });
          }

          totalRegularMs += regularMs;
          totalOvertimeMs += overtimeMs;
          totalDoubleMs += doubleMs;
          totalBreakMs += breakMs;
          const split = splitHours(regularMs, overtimeMs, doubleMs);
          return {
            weekStart: ws,
            priorHours: hours(priorMs),
            regularHours: split.regularHours,
            overtimeHours: split.overtimeHours,
            doubleTimeHours: split.doubleTimeHours,
            breakHours: hours(breakMs),
            totalWorkedHours: split.workedHours,
            hasIncomplete: days.some((d) => d.hasIncomplete),
            days,
          };
        })
        .filter((w) => w.days.length > 0);

      const split = splitHours(totalRegularMs, totalOvertimeMs, totalDoubleMs);
      return {
        employeeId: Number(id),
        employeeName: name,
        exempt,
        weeks,
        totalRegularHours: split.regularHours,
        totalOvertimeHours: split.overtimeHours,
        totalDoubleTimeHours: split.doubleTimeHours,
        totalBreakHours: hours(totalBreakMs),
        totalWorkedHours: split.workedHours,
      };
    })
    .filter((e) => e.weeks.length > 0)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
