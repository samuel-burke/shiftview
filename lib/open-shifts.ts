// Pure domain rules for the Open Shifts pickup marketplace.
//
// An "open shift" is an unassigned slot a manager posts (e.g. to backfill a
// call-out or cover a critical gap). Employees claim shifts they're eligible
// for; a manager approving a claim turns it into a real schedules row.
//
// Everything here is pure and side-effect free so the rules can be unit-tested
// directly and reused by both API routes and the UI. Times are minutes since
// midnight, matching the rest of the domain (see data/types.ts).

import { isDateKey } from "@/lib/dates";
import { MAX_SHIFT_MINUTES as MAX, MIN_SHIFT_MINUTES as MIN, shiftParts, shiftsOverlap, validateShiftTimes } from "@/lib/shift-times";

// Mirrors the schedule duration bounds (BR-3): at least 1 hour, at most 16.
export const MIN_SHIFT_MINUTES = MIN;
export const MAX_SHIFT_MINUTES = MAX;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type OpenShiftInput = {
  date: string;
  startMinutes: number;
  endMinutes: number;
};

export type ValidationResult = { valid: true } | { valid: false; error: string };

// Validates a proposed open shift against the same rules as a scheduled shift
// (FR-5.5/5.6/5.7, BR-3/BR-4). Returns a structured result so callers can map
// it straight to a 400 response.
export function validateOpenShift(input: OpenShiftInput): ValidationResult {
  const { date, startMinutes, endMinutes } = input;

  if (typeof date !== "string" || !DATE_RE.test(date) || !isDateKey(date)) {
    return { valid: false, error: "Invalid date format (expected YYYY-MM-DD)" };
  }
  // Same rules as a scheduled shift, overnight shifts included (lib/shift-times.ts).
  const error = validateShiftTimes(startMinutes, endMinutes);
  if (error) return { valid: false, error };

  return { valid: true };
}

// Half-open interval overlap: shifts that merely touch at an endpoint
// (one ends exactly when the next begins) do not overlap.
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type EligibilityContext = {
  // The employee's existing scheduled shifts.
  schedules: { date: string; startMinutes: number; endMinutes: number }[];
  // The employee's time-off requests.
  timeOff: { date: string; status: string }[];
  // The employee's call-outs.
  callouts: { date: string }[];
};

export type EligibilityResult = { eligible: boolean; reason?: string };

// Whether an employee may claim a given open shift. A claim is blocked when, on
// any day the shift touches, the employee has called out or is on approved time
// off, or when they're already scheduled for an overlapping shift. RLS and the API layer remain the
// authoritative enforcement points; this keeps the rule in one tested place.
export function isEmployeeEligible(
  shift: OpenShiftInput,
  ctx: EligibilityContext
): EligibilityResult {
  // Every day the shift touches — two for an overnight shift.
  const days = shiftParts(shift).map((p) => p.date);
  if (ctx.callouts.some((c) => days.includes(c.date))) {
    return { eligible: false, reason: "You are called out on this day" };
  }
  if (ctx.timeOff.some((t) => days.includes(t.date) && t.status === "approved")) {
    return { eligible: false, reason: "You are on approved time off this day" };
  }
  // Any overlapping shift, including one on a neighbouring day that runs past
  // midnight (or that this overnight shift runs into).
  if (ctx.schedules.some((s) => shiftsOverlap(s, shift))) {
    return { eligible: false, reason: "You are already scheduled at this time" };
  }
  return { eligible: true };
}
