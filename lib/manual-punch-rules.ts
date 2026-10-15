// Rules for a punch correction an *employee* requests for themselves (managers
// are trusted to correct anything). Live punches never take a client time at
// all; these rules keep corrections from being used to rewrite real history.
// They're checked when the request is filed and again when a manager approves
// it. In the database, employees can't insert manual punches at all
// (supabase/migrations/0031_punch_correction_requests.sql) — only an approving
// manager can.

import type { SupabaseClient } from "@supabase/supabase-js";
import { dateKeyInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

// Which punch types may follow the previous punch (null = no prior punch).
const NEXT_ALLOWED: Record<string, PunchKind[]> = {
  none:        ["clock_in"],
  clock_out:   ["clock_in"],
  clock_in:    ["clock_out", "break_start"],
  break_end:   ["clock_out", "break_start"],
  break_start: ["break_end"],
};

type PunchRef = { punchType: string; punchedAt?: string };

// Mirrors the live clock (enforce_punch_integrity in
// supabase/migrations/0047_store_timezone.sql): a clock-in over a punch that
// left the shift open counts as a new shift when that punch is more than a
// minute older and from an earlier store day — the forgotten clock-out case.
// Without both times and the store timezone we can't tell, so it doesn't apply.
function opensNewShiftOver(open: PunchRef, clockInAt: string | undefined, tz: string | undefined): boolean {
  if (!open.punchedAt || !clockInAt || !tz) return false;
  const openMs = Date.parse(open.punchedAt);
  const inMs = Date.parse(clockInAt);
  if (!Number.isFinite(openMs) || !Number.isFinite(inMs) || inMs - openMs <= 60_000) return false;
  return dateKeyInTz(openMs, tz) < dateKeyInTz(inMs, tz);
}

const label = (t: string) => t.replace("_", " ");

// `prev` is the employee's latest punch strictly before the new punch's time;
// `next` is their earliest punch at or after it. Pass `at` (the new punch's
// time, with prev/next `punchedAt`) and the store timezone `tz` so a missed
// clock-in can be filed after an earlier day's forgotten clock-out. Returns an
// error message, or null when the punch is allowed.
export function checkEmployeeManualPunch(
  punchType: PunchKind,
  prev: PunchRef | null,
  next: PunchRef | null,
  at?: string,
  tz?: string,
): string | null {
  const allowed = NEXT_ALLOWED[prev?.punchType ?? "none"] ?? [];
  const followsPrev = allowed.includes(punchType)
    || (punchType === "clock_in" && prev !== null && opensNewShiftOver(prev, at, tz));
  if (!followsPrev) {
    return prev
      ? `A ${label(punchType)} can't follow your ${label(prev.punchType)} punch`
      : "Your first punch must be a clock in";
  }
  // Appending after the latest punch is fine. Inserting before an existing
  // punch is only allowed to close a previous shift that was left open: the
  // following punch must be the clock-in that started a new shift, and the new
  // punch must actually close the old one, so the clock-in is still a valid
  // next step after it. Anything else (an earlier clock-in ahead of a real,
  // late one, or a break start that leaves the old shift open) would rewrite
  // recorded time or leave a broken sequence.
  if (next) {
    const closesOpenShift = prev !== null && prev.punchType !== "clock_out" && next.punchType === "clock_in"
      && (punchType === "clock_out"
        // A forgotten break end from an earlier store day also counts — the
        // clock-in may follow it, as on the live clock — so the clock-out can
        // then be filed after it.
        || (punchType === "break_end" && opensNewShiftOver({ punchType, punchedAt: at }, next.punchedAt, tz)));
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
// `tz` is the store timezone; it's looked up when not passed. `excludePunchId`
// leaves out a punch that was just inserted, to re-check it against its
// neighbours afterwards.
export async function checkManualPunchAgainstHistory(
  supabase: PunchQueryClient,
  orgId: string,
  employeeId: number,
  punchType: PunchKind,
  punchedAtIso: string,
  { tz, excludePunchId }: { tz?: string; excludePunchId?: number } = {},
): Promise<string | null> {
  const neighbour = (side: "prev" | "next") => {
    let q = supabase
      .from("punch_records")
      .select("punch_type, punched_at")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId);
    if (excludePunchId !== undefined) q = q.neq("id", excludePunchId);
    return (side === "prev" ? q.lt("punched_at", punchedAtIso) : q.gte("punched_at", punchedAtIso))
      .order("punched_at", { ascending: side === "next" })
      .limit(1)
      .maybeSingle();
  };
  const [{ data: prev }, { data: next }, storeTz] = await Promise.all([
    neighbour("prev"),
    neighbour("next"),
    tz ?? getOrgTimezone(supabase as SupabaseClient, orgId),
  ]);
  return checkEmployeeManualPunch(
    punchType,
    prev ? { punchType: prev.punch_type, punchedAt: prev.punched_at } : null,
    next ? { punchType: next.punch_type, punchedAt: next.punched_at } : null,
    punchedAtIso,
    storeTz,
  );
}
