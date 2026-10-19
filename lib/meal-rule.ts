// The optional meal rule (lib/break-rules.ts): a shift worked longer than N
// minutes needs a meal break that starts no later than N minutes of work in.
//
// Judged per shift (a clock-in and the punches after it, up to its clock-out),
// on worked time: time on the clock less unpaid breaks, so a paid rest break
// counts as work, as payroll pays it. A meal break is an unpaid break lasting
// at least its type's minimum length, or MEAL_MIN_MINUTES when the type sets
// none. A shift still open is not judged: its meal may be yet to come.
//
//   * worked exactly N minutes or less: no meal needed;
//   * worked more, with no meal break: "missed";
//   * worked more, with the first meal break starting after more than N
//     minutes of work: "late". Starting at exactly N minutes is on time.

import { MEAL_MIN_MINUTES } from "@/lib/break-rules";
import { assignPunchDays } from "@/lib/punch-sessions";

export type MealPunch = {
  id: number;
  punchType: string;
  punchedAt: string;
  breakPaid?: boolean | null;
  breakTypeId?: number | null;
};

export type MealFlag = {
  kind: "missed" | "late";
  // Worked minutes in the shift, and before its first meal break (late only).
  workedMinutes: number;
  workedBeforeMealMinutes: number | null;
  // The clock-out for a missed meal; the late meal's break start.
  punchId: number;
};

const MIN_MS = 60_000;

export function mealFlags(
  punches: MealPunch[],
  requiredAfterMinutes: number,
  minMinutesFor: (breakTypeId: number | null | undefined) => number | null = () => null,
): MealFlag[] {
  if (!(requiredAfterMinutes > 0)) return [];
  const limitMs = requiredAfterMinutes * MIN_MS;
  const sorted = [...punches].sort(
    (a, b) => Date.parse(a.punchedAt) - Date.parse(b.punchedAt) || a.id - b.id,
  );
  const flags: MealFlag[] = [];

  let inShift = false;
  let workedMs = 0;
  let segStart: number | null = null;
  let openBreak: { at: number; workedBefore: number; paid: boolean; typeId: number | null | undefined; id: number } | null = null;
  let meal: { workedBefore: number; id: number } | null = null;

  const reset = () => { workedMs = 0; segStart = null; openBreak = null; meal = null; };

  for (const p of sorted) {
    const t = Date.parse(p.punchedAt);
    switch (p.punchType) {
      case "clock_in":
        reset();
        inShift = true;
        segStart = t;
        break;
      case "break_start":
        if (!inShift || openBreak) break;
        if (p.breakPaid) {
          openBreak = { at: t, workedBefore: workedMs + (segStart !== null ? t - segStart : 0), paid: true, typeId: p.breakTypeId, id: p.id };
        } else {
          if (segStart !== null) { workedMs += t - segStart; segStart = null; }
          openBreak = { at: t, workedBefore: workedMs, paid: false, typeId: p.breakTypeId, id: p.id };
        }
        break;
      case "break_end":
        if (!inShift || !openBreak) break;
        if (!openBreak.paid) {
          const minMinutes = minMinutesFor(openBreak.typeId) ?? MEAL_MIN_MINUTES;
          if (!meal && t - openBreak.at >= minMinutes * MIN_MS) meal = { workedBefore: openBreak.workedBefore, id: openBreak.id };
          segStart = t;
        }
        openBreak = null;
        break;
      case "clock_out": {
        if (!inShift) break;
        if (segStart !== null) workedMs += t - segStart;
        // A break left open at clock-out never ended, so it is no meal.
        if (workedMs > limitMs) {
          const m = meal as { workedBefore: number; id: number } | null;
          if (!m) {
            flags.push({ kind: "missed", workedMinutes: Math.round(workedMs / MIN_MS), workedBeforeMealMinutes: null, punchId: p.id });
          } else if (m.workedBefore > limitMs) {
            flags.push({ kind: "late", workedMinutes: Math.round(workedMs / MIN_MS), workedBeforeMealMinutes: Math.round(m.workedBefore / MIN_MS), punchId: m.id });
          }
        }
        inShift = false;
        reset();
        break;
      }
    }
  }
  return flags;
}

export type MealCountRow = {
  id: number;
  employee_id: number;
  punch_type: string;
  punched_at: string;
  break_paid?: boolean | null;
  break_type_id?: number | null;
};

/**
 * Meal flags (missed and late) per employee and store day, the day being the
 * one payroll books the shift to (its clock-in's, lib/punch-sessions.ts).
 */
export function mealFlagCounts(
  rows: MealCountRow[],
  tz: string,
  requiredAfterMinutes: number,
  minMinutesFor: (breakTypeId: number | null | undefined) => number | null = () => null,
): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  if (!(requiredAfterMinutes > 0)) return out;
  const byEmployee = new Map<number, MealCountRow[]>();
  for (const r of rows) {
    const list = byEmployee.get(r.employee_id) ?? [];
    list.push(r);
    byEmployee.set(r.employee_id, list);
  }
  for (const [employeeId, list] of byEmployee) {
    const sorted = [...list].sort((a, b) => Date.parse(a.punched_at) - Date.parse(b.punched_at) || a.id - b.id);
    const days = assignPunchDays(sorted.map((p) => ({ punchType: p.punch_type, punchedAt: p.punched_at })), tz);
    const dayOf = new Map(sorted.map((p, i) => [p.id, days[i].day]));
    const flags = mealFlags(
      sorted.map((p) => ({ id: p.id, punchType: p.punch_type, punchedAt: p.punched_at, breakPaid: p.break_paid, breakTypeId: p.break_type_id })),
      requiredAfterMinutes,
      minMinutesFor,
    );
    const counts = new Map<string, number>();
    for (const f of flags) {
      const day = dayOf.get(f.punchId);
      if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    if (counts.size) out.set(employeeId, counts);
  }
  return out;
}
