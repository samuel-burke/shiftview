// Rules for a manual punch an *employee* adds for themselves (managers are
// trusted to correct anything). Live punches never take a client time at all;
// these rules keep manual ones from being used to rewrite real history.
//
// Mirrored in the database by enforce_punch_integrity()
// (supabase/migrations/0030_punch_timestamp_integrity.sql) so the rules hold
// even for writes that bypass the API.

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

// Which punch types may follow the previous punch (null = no prior punch).
const NEXT_ALLOWED: Record<string, PunchKind[]> = {
  none:        ["clock_in"],
  clock_out:   ["clock_in"],
  clock_in:    ["clock_out", "break_start"],
  break_end:   ["clock_out", "break_start"],
  break_start: ["break_end"],
};

// `prev` is the employee's latest punch strictly before the new punch's time;
// `next` is their earliest punch at or after it. Returns an error message, or
// null when the punch is allowed.
export function checkEmployeeManualPunch(
  punchType: PunchKind,
  prev: { punchType: string } | null,
  next: { punchType: string } | null,
): string | null {
  const allowed = NEXT_ALLOWED[prev?.punchType ?? "none"] ?? [];
  if (!allowed.includes(punchType)) {
    return prev
      ? `A ${punchType.replace("_", " ")} can't follow your ${prev.punchType.replace("_", " ")} punch`
      : "Your first punch must be a clock in";
  }
  // Appending after the latest punch is fine. Inserting before an existing
  // punch is only allowed to close a previous shift that was left open — the
  // following punch must be the clock-in that started a new shift. Anything
  // else (e.g. an earlier clock-in ahead of a real, late one) would rewrite
  // recorded time.
  if (next) {
    const closesOpenShift = prev !== null && prev.punchType !== "clock_out" && next.punchType === "clock_in";
    if (!closesOpenShift) {
      return "A manual punch can't be placed before your existing punches — ask a manager to correct it";
    }
  }
  return null;
}
