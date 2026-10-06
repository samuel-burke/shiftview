import { validateShiftTimes } from "@/lib/shift-times";

// Shift times: start 0–1439, end after start — past 1440 for an overnight
// shift — and 1–16 hours long. See lib/shift-times.ts.
export function validateShiftMinutes(startMinutes: unknown, endMinutes: unknown): string | null {
  return validateShiftTimes(startMinutes, endMinutes);
}
