// Employee shift preferences: what someone would like to work, as opposed to
// availability (when they can) and the manager-set limits in
// lib/scheduling-rules.ts. The auto-scheduler treats these as soft goals.
// Days are 0 = Sunday … 6 = Saturday, like availability.

import type { ShiftType } from "@/data/types";
import { MAX_WEEKLY_HOURS } from "@/lib/scheduling-rules";

export const SHIFT_TYPES: ShiftType[] = ["opener", "mid", "closer"];
export const PREFERENCE_NOTE_MAX = 500;

export type ShiftPreferences = {
  employeeId: number;
  preferredShiftTypes: ShiftType[];
  preferredDays: number[];
  avoidDays: number[];
  desiredWeeklyHours: number | null;
  note: string | null;
  // Null until the preferences are first saved.
  updatedAt: string | null;
};

export type PreferencesRow = {
  employee_id: number;
  preferred_shift_types: string[] | null;
  preferred_days: number[] | null;
  avoid_days: number[] | null;
  desired_weekly_hours: number | string | null;
  note: string | null;
  updated_at: string | null;
};

export function emptyPreferences(employeeId: number): ShiftPreferences {
  return {
    employeeId,
    preferredShiftTypes: [],
    preferredDays: [],
    avoidDays: [],
    desiredWeeklyHours: null,
    note: null,
    updatedAt: null,
  };
}

export function preferencesFromRow(row: PreferencesRow): ShiftPreferences {
  return {
    employeeId: row.employee_id,
    preferredShiftTypes: (row.preferred_shift_types ?? []).filter((t): t is ShiftType =>
      SHIFT_TYPES.includes(t as ShiftType)
    ),
    preferredDays: [...(row.preferred_days ?? [])].sort((a, b) => a - b),
    avoidDays: [...(row.avoid_days ?? [])].sort((a, b) => a - b),
    desiredWeeklyHours: row.desired_weekly_hours == null ? null : Number(row.desired_weekly_hours),
    note: row.note,
    updatedAt: row.updated_at,
  };
}

export function hasPreferences(p: ShiftPreferences): boolean {
  return (
    p.preferredShiftTypes.length > 0 ||
    p.preferredDays.length > 0 ||
    p.avoidDays.length > 0 ||
    p.desiredWeeklyHours !== null
  );
}

function dayList(v: unknown, field: string): number[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    return `${field} must be a list of days 0–6`;
  return [...new Set(v as number[])].sort((a, b) => a - b);
}

export type PreferencesInput = {
  preferred_shift_types: ShiftType[];
  preferred_days: number[];
  avoid_days: number[];
  desired_weekly_hours: number | null;
  note: string | null;
};

// Validates a full preferences update (a PUT replaces every field; omitted
// fields are cleared) and converts it to columns.
export function validatePreferencesInput(
  input: Record<string, unknown>
): { values: PreferencesInput; error: null } | { error: string } {
  const { preferredShiftTypes, preferredDays, avoidDays, desiredWeeklyHours, note } = input;

  let shiftTypes: ShiftType[] = [];
  if (preferredShiftTypes !== undefined && preferredShiftTypes !== null) {
    if (!Array.isArray(preferredShiftTypes) || !preferredShiftTypes.every((t) => SHIFT_TYPES.includes(t)))
      return { error: "preferredShiftTypes must be a list of opener, mid or closer" };
    shiftTypes = SHIFT_TYPES.filter((t) => preferredShiftTypes.includes(t));
  }

  const preferred = dayList(preferredDays, "preferredDays");
  if (typeof preferred === "string") return { error: preferred };
  const avoid = dayList(avoidDays, "avoidDays");
  if (typeof avoid === "string") return { error: avoid };
  if (preferred.some((d) => avoid.includes(d)))
    return { error: "A day can't be both preferred and avoided" };

  if (
    desiredWeeklyHours !== undefined &&
    desiredWeeklyHours !== null &&
    (typeof desiredWeeklyHours !== "number" ||
      !Number.isInteger(desiredWeeklyHours * 2) ||
      desiredWeeklyHours < 0 ||
      desiredWeeklyHours > MAX_WEEKLY_HOURS)
  )
    return { error: `desiredWeeklyHours must be a whole or half hour between 0 and ${MAX_WEEKLY_HOURS}, or null` };

  if (note !== undefined && note !== null && typeof note !== "string")
    return { error: "note must be a string or null" };
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (trimmedNote.length > PREFERENCE_NOTE_MAX)
    return { error: `note must be ${PREFERENCE_NOTE_MAX} characters or fewer` };

  return {
    values: {
      preferred_shift_types: shiftTypes,
      preferred_days: preferred,
      avoid_days: avoid,
      desired_weekly_hours: (desiredWeeklyHours as number | null | undefined) ?? null,
      note: trimmedNote || null,
    },
    error: null,
  };
}
