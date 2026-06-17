// Pure domain rules for the Open Shifts pickup marketplace.
//
// An "open shift" is an unassigned slot a manager posts (e.g. to backfill a
// call-out or cover a critical gap). Employees claim shifts they're eligible
// for; a manager approving a claim turns it into a real schedules row.
//
// Everything here is pure and side-effect free so the rules can be unit-tested
// directly and reused by both API routes and the UI. Times are minutes since
// midnight, matching the rest of the domain (see data/types.ts).

// Mirrors the schedule duration bounds (BR-3): at least 1 hour, at most 16.
export const MIN_SHIFT_MINUTES = 60;
export const MAX_SHIFT_MINUTES = 960;

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

  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return { valid: false, error: "Invalid date format (expected YYYY-MM-DD)" };
  }
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes)) {
    return { valid: false, error: "Times must be integer minutes" };
  }
  if (startMinutes < 0 || startMinutes > 1440 || endMinutes < 0 || endMinutes > 1440) {
    return { valid: false, error: "Times must be within 0–1440 minutes" };
  }
  if (startMinutes >= endMinutes) {
    return { valid: false, error: "Start time must be before end time" };
  }

  const duration = endMinutes - startMinutes;
  if (duration < MIN_SHIFT_MINUTES) {
    return { valid: false, error: "Shift must be at least 1 hour" };
  }
  if (duration > MAX_SHIFT_MINUTES) {
    return { valid: false, error: "Shift must be at most 16 hours" };
  }

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
// the shift's date, the employee has called out, is on approved time off, or is
// already scheduled for an overlapping shift. RLS and the API layer remain the
// authoritative enforcement points; this keeps the rule in one tested place.
export function isEmployeeEligible(
  shift: OpenShiftInput,
  ctx: EligibilityContext
): EligibilityResult {
  if (ctx.callouts.some((c) => c.date === shift.date)) {
    return { eligible: false, reason: "You are called out on this day" };
  }
  if (ctx.timeOff.some((t) => t.date === shift.date && t.status === "approved")) {
    return { eligible: false, reason: "You are on approved time off this day" };
  }
  if (
    ctx.schedules.some(
      (s) =>
        s.date === shift.date &&
        overlaps(s.startMinutes, s.endMinutes, shift.startMinutes, shift.endMinutes)
    )
  ) {
    return { eligible: false, reason: "You are already scheduled at this time" };
  }
  return { eligible: true };
}
