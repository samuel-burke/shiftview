// An employee's optional note on a live punch ("covering for Sam"). Cleaned the
// same way in the database (clean_punch_note, migration 0065), which also
// holds the length limit, so a note written straight to the table ends up the
// same as one sent through POST /api/punches.

export const PUNCH_NOTE_MAX_LENGTH = 140;

// Control characters (C0 and C1), zero-width characters, line/paragraph
// separators, bidi embeddings and overrides, and the byte-order mark: none
// belong in a one-line note, and the bidi ones can make it read backwards.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;

/** The note as it will be stored: unsafe characters become spaces, whitespace collapses, the ends are trimmed; blank is null. */
export function cleanPunchNote(raw: string): string | null {
  const cleaned = raw.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}

export type PunchNoteResult = { ok: true; note: string | null } | { ok: false; error: string };

/** Validates and cleans the optional `note` a client sends with a live punch. */
export function parsePunchNote(raw: unknown): PunchNoteResult {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: false, error: "note must be a string" };
  const note = cleanPunchNote(raw);
  // Code points, as Postgres char_length counts them, so an emoji is one.
  if (note !== null && [...note].length > PUNCH_NOTE_MAX_LENGTH)
    return { ok: false, error: `note must be ${PUNCH_NOTE_MAX_LENGTH} characters or fewer` };
  return { ok: true, note };
}
