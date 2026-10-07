// Rules for a punch correction an *employee* requests for themselves (managers
// are trusted to correct anything). Live punches never take a client time at
// all; these rules keep corrections from being used to rewrite real history.
// They're checked when the request is filed and again when a manager approves
// it. In the database, employees can't insert manual punches at all
// (supabase/migrations/0031_punch_correction_requests.sql) — only an approving
// manager can.

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

type PunchQueryClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

// Look up the employee's punches either side of `punchedAtIso` and apply
// checkEmployeeManualPunch. Used when an employee files a correction and again
// when a manager approves it, since punches may have changed in between.
export async function checkManualPunchAgainstHistory(
  supabase: PunchQueryClient,
  orgId: string,
  employeeId: number,
  punchType: PunchKind,
  punchedAtIso: string,
): Promise<string | null> {
  const [{ data: prev }, { data: next }] = await Promise.all([
    supabase
      .from("punch_records")
      .select("punch_type, punched_at")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .lt("punched_at", punchedAtIso)
      .order("punched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("punch_records")
      .select("punch_type, punched_at")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .gte("punched_at", punchedAtIso)
      .order("punched_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  return checkEmployeeManualPunch(
    punchType,
    prev ? { punchType: prev.punch_type } : null,
    next ? { punchType: next.punch_type } : null,
  );
}
