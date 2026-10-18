// The employee's own "My hours" view on the clock screen: this workweek and
// last, with each week's regular/overtime split taken from payroll
// (computePayroll, via /api/timecard's `weeks`) and each day's hours and flags
// from the time card (computeTimecard). Nothing is recalculated here, so the
// employee sees the numbers their manager and payroll see.

import { addDaysToKey, weekStartForKey } from "@/lib/dates";
import { WEEKLY_OVERTIME_THRESHOLD_HOURS, WORKWEEK_START_DAY, type PayrollWeek } from "@/lib/payroll";
import type { TimecardDay, ViolationType } from "@/lib/timecard";

// From this many hours worked in a workweek the clock warns that overtime is
// near: about half a shift before the 40-hour line, early enough to plan the
// rest of the week. A constant rather than a setting until someone needs it.
export const APPROACHING_OVERTIME_HOURS = 36;

export type MyHoursFlag = { label: string; tone: "bad" | "warn" | "info" };

export type MyHoursDay = {
  date: string;
  dayName: string;
  workedHours: number;
  breakHours: number;
  flags: MyHoursFlag[];
};

export type MyHoursWeek = {
  weekStart: string;
  weekEnd: string;
  workedHours: number;
  regularHours: number;
  overtimeHours: number;
  breakHours: number;
  days: MyHoursDay[];
  // Hours left before overtime starts (0 once in overtime).
  hoursToOvertime: number;
  // Past APPROACHING_OVERTIME_HOURS but not yet in overtime.
  approachingOvertime: boolean;
  // An open shift today: its hours count once it's clocked out.
  shiftInProgress: boolean;
};

// The two workweeks the view covers, as one /api/timecard range. Starting on
// the workweek's first day means no earlier hours count toward its overtime.
export function myHoursRange(todayKey: string): { thisWeekStart: string; lastWeekStart: string; from: string; to: string } {
  const thisWeekStart = weekStartForKey(todayKey, WORKWEEK_START_DAY);
  const lastWeekStart = addDaysToKey(thisWeekStart, -7);
  return { thisWeekStart, lastWeekStart, from: lastWeekStart, to: addDaysToKey(thisWeekStart, 6) };
}

// What each time-card violation means to the employee, in their words.
const VIOLATION_FLAGS: Record<ViolationType, MyHoursFlag> = {
  late_in:     { label: "Late", tone: "bad" },
  ncns:        { label: "No show", tone: "bad" },
  early_out:   { label: "Left early", tone: "warn" },
  long_break:  { label: "Long break", tone: "warn" },
  short_break: { label: "Short break", tone: "warn" },
  callout:     { label: "Called out", tone: "warn" },
  early_in:    { label: "Early in", tone: "info" },
  late_out:    { label: "Stayed late", tone: "info" },
};

function dayFlags(day: TimecardDay, todayKey: string): MyHoursFlag[] {
  const flags: MyHoursFlag[] = [];
  // Unpaired punches today are usually just the shift still running; on an
  // earlier day they mean a missed punch that needs a correction.
  if (day.hasIncomplete) {
    flags.push(day.date === todayKey
      ? { label: "In progress", tone: "info" }
      : { label: "Missing punch", tone: "bad" });
  }
  for (const v of day.violations) {
    const flag = VIOLATION_FLAGS[v.type];
    if (flag && !flags.some((f) => f.label === flag.label)) flags.push(flag);
  }
  if (day.punches.some((p) => p.isManual)) flags.push({ label: "Manual punch", tone: "info" });
  return flags;
}

export function summarizeWeek(
  days: TimecardDay[],
  weeks: PayrollWeek[],
  weekStart: string,
  todayKey: string,
): MyHoursWeek {
  const weekEnd = addDaysToKey(weekStart, 6);
  const payroll = weeks.find((w) => w.weekStart === weekStart);
  const workedHours = payroll?.totalWorkedHours ?? 0;
  const weekDays = days
    // Days still to come only carry a scheduled shift — nothing worked yet.
    .filter((d) => d.date >= weekStart && d.date <= weekEnd && d.date <= todayKey)
    .map((d) => ({
      date: d.date,
      dayName: d.dayName,
      workedHours: d.workedHours,
      breakHours: d.breakHours,
      flags: dayFlags(d, todayKey),
    }));
  const hoursToOvertime = Math.max(0, Math.round((WEEKLY_OVERTIME_THRESHOLD_HOURS - workedHours) * 100) / 100);
  return {
    weekStart,
    weekEnd,
    workedHours,
    regularHours: payroll?.regularHours ?? 0,
    overtimeHours: payroll?.overtimeHours ?? 0,
    breakHours: payroll?.breakHours ?? 0,
    days: weekDays,
    hoursToOvertime,
    approachingOvertime: workedHours >= APPROACHING_OVERTIME_HOURS && hoursToOvertime > 0,
    shiftInProgress: days.some((d) => d.date === todayKey && d.date >= weekStart && d.date <= weekEnd && d.hasIncomplete),
  };
}

// Decimal hours as "7h 30m" — easier to check against a shift than "7.50".
export function formatHours(h: number): string {
  const total = Math.round(h * 60);
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  if (hrs === 0 && mins === 0) return "0h";
  if (hrs === 0) return `${mins}m`;
  return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
}
