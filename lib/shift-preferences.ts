// Pure helpers for an employee's *soft* shift-type preferences (which of
// opener / mid / closer they'd rather work). Unlike availability (a hard
// constraint), this is a preference a manager can honor to improve satisfaction.
// Stored as a comma-separated string on the employee row; an empty list means
// "no preference".

import type { ShiftType } from "../data/types";

export const SHIFT_TYPES: ShiftType[] = ["opener", "mid", "closer"];

export type PreferencesResult =
  | { valid: true; value: ShiftType[] }
  | { valid: false; error: string };

// Validate an incoming list: every entry must be a known shift type. The result
// is deduped and returned in canonical SHIFT_TYPES order.
export function validateShiftPreferences(input: unknown): PreferencesResult {
  if (!Array.isArray(input)) return { valid: false, error: "shiftTypes must be an array" };
  for (const t of input) {
    if (!SHIFT_TYPES.includes(t as ShiftType))
      return { valid: false, error: `Unknown shift type: ${String(t)}` };
  }
  const set = new Set(input as ShiftType[]);
  return { valid: true, value: SHIFT_TYPES.filter((t) => set.has(t)) };
}

export function serializeShiftPreferences(prefs: ShiftType[]): string {
  return prefs.join(",");
}

export function parseShiftPreferences(stored: string | null): ShiftType[] {
  if (!stored) return [];
  const set = new Set(stored.split(",").map((s) => s.trim()));
  return SHIFT_TYPES.filter((t) => set.has(t));
}

// Whether a shift of `shiftType` aligns with the employee's preferences. With no
// preference set, everything matches.
export function matchesPreference(shiftType: ShiftType, prefs: ShiftType[]): boolean {
  return prefs.length === 0 || prefs.includes(shiftType);
}
