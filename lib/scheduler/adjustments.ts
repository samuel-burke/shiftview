// Validation for the week's one-off adjustments sent with an Auto-schedule
// request (see Adjustment in ./types).

import { MAX_HEADCOUNT, SLOT_MINUTES } from "@/lib/coverage";
import { MAX_WEEKLY_HOURS } from "@/lib/scheduling-rules";
import type { Adjustment } from "./types";

export const MAX_ADJUSTMENTS = 50;

const isHalfHours = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v * 2) && v >= 0 && v <= MAX_WEEKLY_HOURS;

export function parseAdjustments(
  input: unknown,
  weekDates: string[],
  employeeIds: Set<number>
): { adjustments: Adjustment[]; error: null } | { error: string } {
  if (input === undefined || input === null) return { adjustments: [], error: null };
  if (!Array.isArray(input)) return { error: "adjustments must be a list" };
  if (input.length > MAX_ADJUSTMENTS) return { error: `at most ${MAX_ADJUSTMENTS} adjustments` };
  const week = new Set(weekDates);
  const out: Adjustment[] = [];

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) return { error: "each adjustment must be an object" };
    const a = raw as Record<string, unknown>;
    switch (a.kind) {
      case "coverage": {
        const { date, startMinutes: s, endMinutes: e, delta } = a;
        if (typeof date !== "string" || !week.has(date)) return { error: "coverage adjustment date must be in the week" };
        if (!Number.isInteger(s) || !Number.isInteger(e)) return { error: "coverage adjustment times must be integers" };
        const start = s as number, end = e as number;
        if (start < 0 || end > 1440 || start >= end || start % SLOT_MINUTES || end % SLOT_MINUTES)
          return { error: `coverage adjustment times must be ${SLOT_MINUTES}-minute steps within the day` };
        if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta as number) > MAX_HEADCOUNT)
          return { error: "coverage adjustment delta must be a non-zero whole number of people" };
        out.push({ kind: "coverage", date, startMinutes: start, endMinutes: end, delta: delta as number });
        break;
      }
      case "employee_off": {
        const { employeeId, date } = a;
        if (!Number.isInteger(employeeId) || !employeeIds.has(employeeId as number)) return { error: "unknown employee in adjustment" };
        if (typeof date !== "string" || !week.has(date)) return { error: "employee_off adjustment date must be in the week" };
        out.push({ kind: "employee_off", employeeId: employeeId as number, date });
        break;
      }
      case "employee_hours": {
        const { employeeId } = a;
        const minHours = a.minHours ?? null;
        const maxHours = a.maxHours ?? null;
        if (!Number.isInteger(employeeId) || !employeeIds.has(employeeId as number)) return { error: "unknown employee in adjustment" };
        if (minHours === null && maxHours === null) return { error: "employee_hours adjustment needs minHours or maxHours" };
        if ((minHours !== null && !isHalfHours(minHours)) || (maxHours !== null && !isHalfHours(maxHours)))
          return { error: `employee_hours must be whole or half hours between 0 and ${MAX_WEEKLY_HOURS}` };
        if (minHours !== null && maxHours !== null && minHours > maxHours)
          return { error: "employee_hours minHours cannot exceed maxHours" };
        out.push({ kind: "employee_hours", employeeId: employeeId as number, minHours, maxHours });
        break;
      }
      default:
        return { error: "adjustment kind must be coverage, employee_off or employee_hours" };
    }
  }
  return { adjustments: out, error: null };
}
