// Per-organization rules for the auto-scheduler (lib/scheduler), and
// the per-employee limits it schedules within.
//
// Org rules are stored in app_settings as individual text key/value rows, the
// same shape as every other org setting (see lib/punch-policy.ts), and parsed
// into this typed object. Unset keys fall back to DEFAULT_SCHEDULING_RULES, so
// existing orgs get sensible behavior with no data migration.

import { MAX_SHIFT_MINUTES, MIN_SHIFT_MINUTES } from "@/lib/shift-times";

export type OvertimePolicy = "never" | "when_needed";
export type PendingTimeOffPolicy = "avoid" | "ignore";
export type EmploymentType = "full_time" | "part_time";

export const EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "part_time"];

export type SchedulingRules = {
  // Length of generated shifts, in minutes.
  minShiftMinutes: number;
  maxShiftMinutes: number;
  // Generated shifts start on this grid: every 15, 30 or 60 minutes.
  startGranularityMinutes: number;
  // Least time off between the end of one shift and the start of the next.
  minRestMinutes: number;
  // Longest run of consecutive working days.
  maxConsecutiveDays: number;
  // "never": nobody is scheduled past the weekly overtime threshold (40 h).
  // "when_needed": overtime is allowed, at its 1.5× cost, to close a coverage gap.
  overtimePolicy: OvertimePolicy;
  // Pending (not yet approved) time off: avoid those days when possible, or ignore.
  pendingTimeOff: PendingTimeOffPolicy;
  // Limits for employees who don't have their own, by employment type.
  fullTimeMinHours: number;
  fullTimeMaxHours: number;
  fullTimeMaxDays: number;
  partTimeMinHours: number;
  partTimeMaxHours: number;
  partTimeMaxDays: number;
};

export const DEFAULT_SCHEDULING_RULES: SchedulingRules = {
  minShiftMinutes: 240,
  maxShiftMinutes: 480,
  startGranularityMinutes: 30,
  minRestMinutes: 600,
  maxConsecutiveDays: 6,
  overtimePolicy: "never",
  pendingTimeOff: "avoid",
  fullTimeMinHours: 32,
  fullTimeMaxHours: 40,
  fullTimeMaxDays: 5,
  // 29 h keeps part-timers under the 30 h/week ACA full-time line.
  partTimeMinHours: 0,
  partTimeMaxHours: 29,
  partTimeMaxDays: 5,
};

// Weekly hours (rules and per-employee limits) are whole or half hours.
export const MAX_WEEKLY_HOURS = 80;

type NumberKind = "minutes15" | "granularity" | "integer" | "hours";

// Field ↔ app_settings key mapping, used for parsing, validation and
// serialization. Kept as data so the three can never drift out of sync.
const NUMERIC_FIELDS: { field: keyof SchedulingRules; key: string; kind: NumberKind; min: number; max: number }[] = [
  { field: "minShiftMinutes",         key: "sched_min_shift_minutes",         kind: "minutes15",   min: MIN_SHIFT_MINUTES, max: MAX_SHIFT_MINUTES },
  { field: "maxShiftMinutes",         key: "sched_max_shift_minutes",         kind: "minutes15",   min: MIN_SHIFT_MINUTES, max: MAX_SHIFT_MINUTES },
  { field: "startGranularityMinutes", key: "sched_start_granularity_minutes", kind: "granularity", min: 15, max: 60 },
  { field: "minRestMinutes",          key: "sched_min_rest_minutes",          kind: "minutes15",   min: 0, max: 1440 },
  { field: "maxConsecutiveDays",      key: "sched_max_consecutive_days",      kind: "integer",     min: 1, max: 7 },
  { field: "fullTimeMinHours",        key: "sched_ft_min_hours",              kind: "hours",       min: 0, max: MAX_WEEKLY_HOURS },
  { field: "fullTimeMaxHours",        key: "sched_ft_max_hours",              kind: "hours",       min: 0, max: MAX_WEEKLY_HOURS },
  { field: "fullTimeMaxDays",         key: "sched_ft_max_days",               kind: "integer",     min: 1, max: 7 },
  { field: "partTimeMinHours",        key: "sched_pt_min_hours",              kind: "hours",       min: 0, max: MAX_WEEKLY_HOURS },
  { field: "partTimeMaxHours",        key: "sched_pt_max_hours",              kind: "hours",       min: 0, max: MAX_WEEKLY_HOURS },
  { field: "partTimeMaxDays",         key: "sched_pt_max_days",               kind: "integer",     min: 1, max: 7 },
];

const ENUM_FIELDS: { field: keyof SchedulingRules; key: string; values: readonly string[] }[] = [
  { field: "overtimePolicy", key: "sched_overtime_policy",  values: ["never", "when_needed"] },
  { field: "pendingTimeOff", key: "sched_pending_time_off", values: ["avoid", "ignore"] },
];

// Pairs that must satisfy min <= max, with the message used when they don't.
const MIN_MAX_PAIRS: { min: keyof SchedulingRules; max: keyof SchedulingRules; message: string }[] = [
  { min: "minShiftMinutes",  max: "maxShiftMinutes",  message: "minShiftMinutes cannot exceed maxShiftMinutes" },
  { min: "fullTimeMinHours", max: "fullTimeMaxHours", message: "fullTimeMinHours cannot exceed fullTimeMaxHours" },
  { min: "partTimeMinHours", max: "partTimeMaxHours", message: "partTimeMinHours cannot exceed partTimeMaxHours" },
];

function isValidNumber(n: number, kind: NumberKind, min: number, max: number): boolean {
  if (!Number.isFinite(n) || n < min || n > max) return false;
  switch (kind) {
    case "minutes15":   return Number.isInteger(n) && n % 15 === 0;
    case "granularity": return n === 15 || n === 30 || n === 60;
    case "integer":     return Number.isInteger(n);
    case "hours":       return Number.isInteger(n * 2);
  }
}

function describeNumber(field: string, kind: NumberKind, min: number, max: number): string {
  switch (kind) {
    case "minutes15":   return `${field} must be a multiple of 15 between ${min} and ${max}`;
    case "granularity": return `${field} must be 15, 30 or 60`;
    case "integer":     return `${field} must be an integer between ${min} and ${max}`;
    case "hours":       return `${field} must be a whole or half hour between ${min} and ${max}`;
  }
}

// Builds SchedulingRules from a raw app_settings key→value map. Malformed
// values fall back to the default; so does a min/max pair that's out of order.
export function parseSchedulingRules(map: Record<string, string | undefined>): SchedulingRules {
  const rules = { ...DEFAULT_SCHEDULING_RULES };
  for (const { field, key, kind, min, max } of NUMERIC_FIELDS) {
    const raw = map[key];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (isValidNumber(n, kind, min, max)) (rules[field] as number) = n;
  }
  for (const { field, key, values } of ENUM_FIELDS) {
    const raw = map[key];
    if (raw !== undefined && values.includes(raw)) (rules[field] as string) = raw;
  }
  for (const { min, max } of MIN_MAX_PAIRS) {
    if ((rules[min] as number) > (rules[max] as number)) {
      (rules[min] as number) = DEFAULT_SCHEDULING_RULES[min] as number;
      (rules[max] as number) = DEFAULT_SCHEDULING_RULES[max] as number;
    }
  }
  return rules;
}

// Validates a partial rules patch against the current rules. Returns the
// merged rules and the app_settings rows for the fields the patch set, or an
// error when any field is malformed or the result is inconsistent.
export function applySchedulingRulesPatch(
  input: unknown,
  current: SchedulingRules
): { rules: SchedulingRules; rows: { key: string; value: string }[]; error: null } | { error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { error: "schedulingRules must be an object" };
  const patch = input as Record<string, unknown>;
  const rules = { ...current };
  const rows: { key: string; value: string }[] = [];

  for (const { field, key, kind, min, max } of NUMERIC_FIELDS) {
    const v = patch[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !isValidNumber(v, kind, min, max))
      return { error: describeNumber(field, kind, min, max) };
    (rules[field] as number) = v;
    rows.push({ key, value: String(v) });
  }
  for (const { field, key, values } of ENUM_FIELDS) {
    const v = patch[field];
    if (v === undefined) continue;
    if (typeof v !== "string" || !values.includes(v))
      return { error: `${field} must be one of: ${values.join(", ")}` };
    (rules[field] as string) = v;
    rows.push({ key, value: v });
  }
  for (const { min, max, message } of MIN_MAX_PAIRS) {
    if ((rules[min] as number) > (rules[max] as number)) return { error: message };
  }
  return { rules, rows, error: null };
}

// ---------------------------------------------------------------------------
// Per-employee limits
// ---------------------------------------------------------------------------

export type EmployeeSchedulingFields = {
  employmentType?: EmploymentType | null;
  minWeeklyHours?: number | null;
  maxWeeklyHours?: number | null;
  maxDaysPerWeek?: number | null;
};

export type EmployeeLimits = {
  type: EmploymentType;
  // False when the employee has no employment type yet (treated as part-time).
  typeSet: boolean;
  minMinutes: number;
  maxMinutes: number;
  maxDays: number;
};

// The limits the scheduler applies to an employee: their own where set, the
// org's default for their employment type otherwise. An unset type counts as
// part-time. A personal maximum below the type's default minimum wins: the
// minimum never exceeds the maximum.
export function resolveEmployeeLimits(emp: EmployeeSchedulingFields, rules: SchedulingRules): EmployeeLimits {
  const type: EmploymentType = emp.employmentType ?? "part_time";
  const fullTime = type === "full_time";
  const maxHours = emp.maxWeeklyHours ?? (fullTime ? rules.fullTimeMaxHours : rules.partTimeMaxHours);
  const minHours = emp.minWeeklyHours ?? (fullTime ? rules.fullTimeMinHours : rules.partTimeMinHours);
  return {
    type,
    typeSet: emp.employmentType != null,
    minMinutes: Math.round(Math.min(minHours, maxHours) * 60),
    maxMinutes: Math.round(maxHours * 60),
    maxDays: emp.maxDaysPerWeek ?? (fullTime ? rules.fullTimeMaxDays : rules.partTimeMaxDays),
  };
}

// The scheduling columns /api/employees returns with each employee.
export type EmployeeLimitColumns = {
  employment_type?: EmploymentType | null;
  min_weekly_hours?: number | null;
  max_weekly_hours?: number | null;
  max_days_per_week?: number | null;
};

export function limitsFromColumns(row: EmployeeLimitColumns, rules: SchedulingRules): EmployeeLimits {
  return resolveEmployeeLimits(
    {
      employmentType: row.employment_type ?? null,
      minWeeklyHours: row.min_weekly_hours ?? null,
      maxWeeklyHours: row.max_weekly_hours ?? null,
      maxDaysPerWeek: row.max_days_per_week ?? null,
    },
    rules
  );
}

function isWeeklyHours(v: unknown): v is number {
  return typeof v === "number" && isValidNumber(v, "hours", 0, MAX_WEEKLY_HOURS);
}

// Validates the scheduling fields of an employee update (each optional; null
// clears a field back to the org default). `current` is the stored row, so a
// patch that sets only one of min/max is checked against the other.
export function validateEmployeeSchedulingPatch(
  input: Record<string, unknown>,
  current: EmployeeSchedulingFields
): { updates: Record<string, unknown>; error: null } | { error: string } {
  const updates: Record<string, unknown> = {};
  const { employmentType, minWeeklyHours, maxWeeklyHours, maxDaysPerWeek } = input;

  if (employmentType !== undefined) {
    if (employmentType !== null && !EMPLOYMENT_TYPES.includes(employmentType as EmploymentType))
      return { error: "employmentType must be full_time, part_time or null" };
    updates.employment_type = employmentType;
  }
  if (minWeeklyHours !== undefined) {
    if (minWeeklyHours !== null && !isWeeklyHours(minWeeklyHours))
      return { error: `minWeeklyHours must be a whole or half hour between 0 and ${MAX_WEEKLY_HOURS}, or null` };
    updates.min_weekly_hours = minWeeklyHours;
  }
  if (maxWeeklyHours !== undefined) {
    if (maxWeeklyHours !== null && !isWeeklyHours(maxWeeklyHours))
      return { error: `maxWeeklyHours must be a whole or half hour between 0 and ${MAX_WEEKLY_HOURS}, or null` };
    updates.max_weekly_hours = maxWeeklyHours;
  }
  if (maxDaysPerWeek !== undefined) {
    if (maxDaysPerWeek !== null && (!Number.isInteger(maxDaysPerWeek) || (maxDaysPerWeek as number) < 1 || (maxDaysPerWeek as number) > 7))
      return { error: "maxDaysPerWeek must be an integer between 1 and 7, or null" };
    updates.max_days_per_week = maxDaysPerWeek;
  }

  const min = minWeeklyHours !== undefined ? (minWeeklyHours as number | null) : current.minWeeklyHours ?? null;
  const max = maxWeeklyHours !== undefined ? (maxWeeklyHours as number | null) : current.maxWeeklyHours ?? null;
  if (min != null && max != null && min > max)
    return { error: "minWeeklyHours cannot exceed maxWeeklyHours" };

  return { updates, error: null };
}
