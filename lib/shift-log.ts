// Pure validation for a shift handoff-log entry — a short operational note any
// staff member leaves for the next shift ("Freezer running warm", "Out of
// receipt paper", "Regular's birthday cake in back"). Distinct from manager
// announcements (org-wide broadcasts) and per-shift notes (manager scheduling
// context): the handoff log is staff-authored and scoped to a day.

export const SHIFT_LOG_MAX = 1000;

export type ShiftLogResult =
  | { valid: true; value: string }
  | { valid: false; error: string };

export function validateShiftLogEntry(body: unknown): ShiftLogResult {
  if (typeof body !== "string" || !body.trim())
    return { valid: false, error: "Message is required" };
  const value = body.trim();
  if (value.length > SHIFT_LOG_MAX)
    return { valid: false, error: `Message must be ${SHIFT_LOG_MAX} characters or fewer` };
  return { valid: true, value };
}
