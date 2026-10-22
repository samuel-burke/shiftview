// The scheduling rules Auto-schedule follows (lib/scheduling-rules.ts),
// checked for one shift a manager adds or changes by hand: rest between
// shifts, consecutive working days, days per week, and weekly hours against
// the person's maximum and the 40-hour overtime line. Each broken rule is a
// warning the manager can override, like an availability conflict.

import { addDaysToKey, daysBetweenKeys, weekStartForKey } from "@/lib/dates";
import { fmtMinutes } from "@/data/types";
import { DAY_MINUTES } from "@/lib/shift-times";
import { WEEKLY_OVERTIME_THRESHOLD_MINUTES } from "@/lib/schedule-hours";
import type { EmployeeLimits, SchedulingRules } from "@/lib/scheduling-rules";

export type RuleShift = { id?: number; date: string; startMinutes: number; endMinutes: number };

export type RuleWarning =
  | { rule: "rest"; message: string; restMinutes: number }
  | { rule: "consecutive_days"; message: string; days: number }
  | { rule: "days_per_week"; message: string; days: number }
  | { rule: "max_hours"; message: string; minutes: number }
  | { rule: "overtime"; message: string; minutes: number };

const hours = (m: number) => {
  const h = Math.round((m / 60) * 10) / 10;
  return `${h}h`;
};

// Absolute minutes from an arbitrary epoch day, so shifts on different days compare.
function absolute(s: RuleShift, epoch: string): { start: number; end: number } {
  const offset = daysBetweenKeys(epoch, s.date.slice(0, 10)) * DAY_MINUTES;
  return { start: s.startMinutes + offset, end: s.endMinutes + offset };
}

const weekday = (key: string) =>
  new Date(`${key.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

/**
 * Rules the shift would break, given the person's other shifts (any dates;
 * the shift being edited may be among them and is ignored by id).
 */
export function checkShiftRules({
  shift,
  others,
  rules,
  limits,
  firstDayOfWeek,
}: {
  shift: RuleShift;
  others: RuleShift[];
  rules: SchedulingRules;
  limits: EmployeeLimits;
  firstDayOfWeek: number;
}): RuleWarning[] {
  const date = shift.date.slice(0, 10);
  const rest = others.filter((o) => shift.id === undefined || o.id !== shift.id);
  const warnings: RuleWarning[] = [];

  // Rest: the shortest gap to the shift before and the shift after.
  if (rules.minRestMinutes > 0) {
    const me = absolute(shift, date);
    let worst: { gap: number; other: RuleShift; before: boolean } | null = null;
    for (const o of rest) {
      const w = absolute(o, date);
      if (w.end <= me.start) {
        const gap = me.start - w.end;
        if (gap < rules.minRestMinutes && (!worst || gap < worst.gap)) worst = { gap, other: o, before: true };
      } else if (w.start >= me.end) {
        const gap = w.start - me.end;
        if (gap < rules.minRestMinutes && (!worst || gap < worst.gap)) worst = { gap, other: o, before: false };
      }
    }
    if (worst) {
      const when = `${weekday(worst.other.date)} ${fmtMinutes(worst.before ? worst.other.endMinutes : worst.other.startMinutes)}`;
      warnings.push({
        rule: "rest",
        restMinutes: worst.gap,
        message: worst.before
          ? `Only ${hours(worst.gap)} rest after the shift ending ${when} (your rules ask for ${hours(rules.minRestMinutes)}).`
          : `Only ${hours(worst.gap)} rest before the shift starting ${when} (your rules ask for ${hours(rules.minRestMinutes)}).`,
      });
    }
  }

  // Consecutive working days, counting the shift's own day.
  const workDays = new Set(rest.map((o) => o.date.slice(0, 10)));
  workDays.add(date);
  let run = 1;
  for (let d = addDaysToKey(date, -1); workDays.has(d); d = addDaysToKey(d, -1)) run++;
  for (let d = addDaysToKey(date, 1); workDays.has(d); d = addDaysToKey(d, 1)) run++;
  if (run > rules.maxConsecutiveDays) {
    warnings.push({
      rule: "consecutive_days",
      days: run,
      message: `This makes ${run} days in a row (your rules allow ${rules.maxConsecutiveDays}).`,
    });
  }

  // The store week the shift is in.
  const weekStart = weekStartForKey(date, firstDayOfWeek);
  const weekEnd = addDaysToKey(weekStart, 6);
  const inWeek = (s: RuleShift) => s.date.slice(0, 10) >= weekStart && s.date.slice(0, 10) <= weekEnd;
  const weekShifts = [...rest.filter(inWeek), shift];

  const days = new Set(weekShifts.map((s) => s.date.slice(0, 10))).size;
  if (days > limits.maxDays) {
    warnings.push({
      rule: "days_per_week",
      days,
      message: `This makes ${days} working days this week (limit ${limits.maxDays}).`,
    });
  }

  const minutes = weekShifts.reduce((sum, s) => sum + (s.endMinutes - s.startMinutes), 0);
  // A 40-hour maximum is the overtime line itself: one warning, not two.
  if (minutes > limits.maxMinutes && limits.maxMinutes !== WEEKLY_OVERTIME_THRESHOLD_MINUTES) {
    warnings.push({
      rule: "max_hours",
      minutes,
      message: `This puts them at ${hours(minutes)} this week (their maximum is ${hours(limits.maxMinutes)}).`,
    });
  }
  if (minutes > WEEKLY_OVERTIME_THRESHOLD_MINUTES) {
    warnings.push({
      rule: "overtime",
      minutes: minutes - WEEKLY_OVERTIME_THRESHOLD_MINUTES,
      message: `This is ${hours(minutes - WEEKLY_OVERTIME_THRESHOLD_MINUTES)} of overtime (${hours(minutes)} this week).`,
    });
  }

  return warnings;
}
