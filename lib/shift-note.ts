// Pure validation for a per-shift note — a short free-text label a manager
// attaches to a scheduled shift (e.g. "Training", "Lock up", "Truck delivery").

export const SHIFT_NOTE_MAX = 280;

export type ShiftNoteResult =
  | { valid: true; value: string | null }
  | { valid: false; error: string };

// Returns the normalized note, or null to clear it. Empty/whitespace input
// clears the note; anything non-string (other than null) is rejected.
export function validateShiftNote(note: unknown): ShiftNoteResult {
  if (note === null || note === undefined) return { valid: true, value: null };
  if (typeof note !== "string") return { valid: false, error: "note must be a string or null" };

  const value = note.trim();
  if (!value) return { valid: true, value: null };
  if (value.length > SHIFT_NOTE_MAX)
    return { valid: false, error: `Note must be ${SHIFT_NOTE_MAX} characters or fewer` };

  return { valid: true, value };
}
