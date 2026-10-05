import { dayOfWeekForKey, DEFAULT_TIMEZONE, weekStartForKey } from "@/lib/dates";
import { assignPunchDays } from "@/lib/punch-sessions";

export type PunchRow = {
  id: number;
  employee_id: number;
  punch_type: string;
  punched_at: string;
  employees: { name: string } | null;
};

export type PayrollDay = {
  date: string;
  dayName: string;
  workedHours: number;
  breakHours: number;
  hasIncomplete: boolean;
};

export type PayrollWeek = {
  weekStart: string;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Returns Monday of the week containing dateStr (YYYY-MM-DD)
function getWeekStart(dateStr: string): string {
  return weekStartForKey(dateStr, 1);
}

function getDayName(dateStr: string): string {
  return DAY_NAMES[dayOfWeekForKey(dateStr)];
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

  for (const p of punches) {
    const t = new Date(p.punched_at).getTime();
    switch (p.punch_type) {
      case "clock_in":
        segStart = t;
        break;
      case "break_end":
        if (breakStart !== null) { breakMs += t - breakStart; breakStart = null; }
        segStart = t;
        break;
      case "break_start":
        if (segStart !== null) { workedMs += t - segStart; segStart = null; }
        breakStart = t;
        break;
      case "clock_out":
        if (segStart !== null) { workedMs += t - segStart; segStart = null; }
        if (breakStart !== null) { breakMs += t - breakStart; breakStart = null; }
        break;
    }
  }

  return { workedMs, breakMs, hasIncomplete: segStart !== null || breakStart !== null };
}

// Punches are bucketed into work days in `tz` — the org's timezone — with a
// shift that runs past midnight kept whole on the day it started. Callers query
// a window padded past `range` (so a post-midnight clock-out is included) and
// pass `range` to drop days outside it.
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

  return Object.entries(byEmployee)
    .map(([id, { name, punches }]) => {
      const sorted = [...punches].sort(
        (a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime()
      );

      const byDate: Record<string, PunchRow[]> = {};
      const assigned = assignPunchDays(
        sorted.map((p) => ({ punchType: p.punch_type, punchedAt: p.punched_at })),
        tz,
      );
      sorted.forEach((p, i) => {
        const date = assigned[i].day;
        if (range && (date < range.from || date > range.to)) return;
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(p);
      });

      const byWeek: Record<string, string[]> = {};
      for (const date of Object.keys(byDate)) {
        const ws = getWeekStart(date);
        if (!byWeek[ws]) byWeek[ws] = [];
        byWeek[ws].push(date);
      }

      const weeks: PayrollWeek[] = Object.entries(byWeek)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ws, dates]) => {
          const days: PayrollDay[] = dates.sort().map((date) => {
            const { workedMs, breakMs, hasIncomplete } = computeSegments(byDate[date]);
            return {
              date,
              dayName: getDayName(date),
              workedHours: round2(workedMs / 3_600_000),
              breakHours: round2(breakMs / 3_600_000),
              hasIncomplete,
            };
          });

          const totalWorked = round2(days.reduce((s, d) => s + d.workedHours, 0));
          const totalBreak = round2(days.reduce((s, d) => s + d.breakHours, 0));

          return {
            weekStart: ws,
            regularHours: round2(Math.min(totalWorked, 40)),
            overtimeHours: round2(Math.max(0, totalWorked - 40)),
            breakHours: totalBreak,
            totalWorkedHours: totalWorked,
            hasIncomplete: days.some((d) => d.hasIncomplete),
            days,
          };
        });

      return {
        employeeId: Number(id),
        employeeName: name,
        weeks,
        totalRegularHours: round2(weeks.reduce((s, w) => s + w.regularHours, 0)),
        totalOvertimeHours: round2(weeks.reduce((s, w) => s + w.overtimeHours, 0)),
        totalBreakHours: round2(weeks.reduce((s, w) => s + w.breakHours, 0)),
        totalWorkedHours: round2(weeks.reduce((s, w) => s + w.totalWorkedHours, 0)),
      };
    })
    .filter((e) => e.weeks.length > 0)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
