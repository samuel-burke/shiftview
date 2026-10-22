import { validateShiftTimes } from "@/lib/shift-times";

// Shift times: start 0–1439, end after start — past 1440 for an overnight
// shift — and 1–16 hours long. See lib/shift-times.ts.
export function validateShiftMinutes(startMinutes: unknown, endMinutes: unknown): string | null {
  return validateShiftTimes(startMinutes, endMinutes);
}

export const MAX_SHIFT_NOTE_LENGTH = 280;

// A shift's note from a request body: undefined when the body leaves it out
// (keep what's there), null to clear it, else the trimmed text.
export function parseShiftNote(value: unknown): { note: string | null | undefined; error: string | null } {
  if (value === undefined) return { note: undefined, error: null };
  if (value === null) return { note: null, error: null };
  if (typeof value !== "string") return { note: undefined, error: "note must be a string" };
  const trimmed = value.trim();
  if (trimmed.length > MAX_SHIFT_NOTE_LENGTH)
    return { note: undefined, error: `note can be at most ${MAX_SHIFT_NOTE_LENGTH} characters` };
  return { note: trimmed === "" ? null : trimmed, error: null };
}
