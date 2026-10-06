import { addDaysToKey, dateKeyInTz, localDayBoundsUtc, todayKeyInTz, zonedTimeToUtc } from "@/lib/dates";
import { currentShift, type CurrentShift } from "@/lib/punch-sessions";

type QueryClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type PunchRow = {
  id: number;
  employee_id: number;
  schedule_id?: number | null;
  punch_type: string;
  punched_at: string;
  lat?: number | null;
  lng?: number | null;
  is_manual?: boolean;
  note?: string | null;
  punchType: string;
  punchedAt: string;
};

// Load an employee's current shift (see currentShift in lib/punch-sessions.ts):
// their punches since the start of the previous store day, up to now — never
// future-dated rows.
export async function loadCurrentShift(
  supabase: QueryClient,
  orgId: string,
  employeeId: number,
  tz: string,
  nowMs: number = Date.now(),
): Promise<{ shift: CurrentShift<PunchRow> | null; error: unknown }> {
  const today = todayKeyInTz(tz, nowMs);
  const from = localDayBoundsUtc(addDaysToKey(today, -1), tz).start;
  const { data, error } = await supabase
    .from("punch_records")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("punched_at", from.toISOString())
    .lte("punched_at", new Date(nowMs).toISOString())
    .order("punched_at", { ascending: true });
  if (error) return { shift: null, error };

  const rows: PunchRow[] = ((data ?? []) as Omit<PunchRow, "punchType" | "punchedAt">[]).map((r) => ({
    ...r,
    punchType: r.punch_type,
    punchedAt: r.punched_at,
  }));

  // A shift still open from yesterday stays current until shortly after the
  // end of an overnight shift scheduled to start yesterday (see currentShift).
  const yesterday = addDaysToKey(today, -1);
  const last = rows[rows.length - 1];
  let overnightEndMs: number | null = null;
  if (last && last.punchType !== "clock_out" && dateKeyInTz(last.punchedAt, tz) === yesterday) {
    const { data: overnight } = await supabase
      .from("schedules")
      .select("end_minutes")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("date", yesterday)
      .gt("end_minutes", 1440)
      .order("end_minutes", { ascending: false })
      .limit(1);
    const endMinutes = Array.isArray(overnight) && overnight[0] ? Number(overnight[0].end_minutes) : null;
    if (endMinutes !== null && endMinutes > 1440) overnightEndMs = zonedTimeToUtc(yesterday, endMinutes, tz).getTime();
  }
  return { shift: currentShift(rows, nowMs, tz, overnightEndMs), error: null };
}

// Punches of every shift still open from before the store's midnight (closers
// and overnight shifts), across the org — or one employee. A day's punch list
// starts at midnight, so without these a closer would look "not clocked in"
// on today's dashboard until they clock out.
export async function loadCarriedOverPunches(
  supabase: QueryClient,
  orgId: string,
  tz: string,
  nowMs: number = Date.now(),
  employeeId?: number,
): Promise<{ punches: PunchRow[]; error: unknown }> {
  const today = todayKeyInTz(tz, nowMs);
  const yesterday = addDaysToKey(today, -1);
  let query = supabase
    .from("punch_records")
    .select("*")
    .eq("org_id", orgId)
    .gte("punched_at", localDayBoundsUtc(yesterday, tz).start.toISOString())
    .lte("punched_at", new Date(nowMs).toISOString());
  if (employeeId != null) query = query.eq("employee_id", employeeId);
  const { data, error } = await query.order("punched_at", { ascending: true });
  if (error) return { punches: [], error };

  const byEmployee = new Map<number, PunchRow[]>();
  for (const r of (data ?? []) as Omit<PunchRow, "punchType" | "punchedAt">[]) {
    const row: PunchRow = { ...r, punchType: r.punch_type, punchedAt: r.punched_at };
    const list = byEmployee.get(row.employee_id);
    if (list) list.push(row);
    else byEmployee.set(row.employee_id, [row]);
  }
  // Only employees whose last punch is an open one from yesterday can have a
  // carried-over shift; look up overnight schedules just for them.
  const candidates = [...byEmployee.entries()].filter(([, rows]) => {
    const last = rows[rows.length - 1];
    return last.punchType !== "clock_out" && dateKeyInTz(rows[0].punchedAt, tz) === yesterday;
  });
  if (candidates.length === 0) return { punches: [], error: null };

  const { data: overnight } = await supabase
    .from("schedules")
    .select("employee_id, end_minutes")
    .eq("org_id", orgId)
    .eq("date", yesterday)
    .gt("end_minutes", 1440)
    .in("employee_id", candidates.map(([id]) => id));
  const endByEmployee = new Map<number, number>();
  for (const r of (Array.isArray(overnight) ? overnight : []) as { employee_id: number; end_minutes: number }[]) {
    endByEmployee.set(r.employee_id, Math.max(endByEmployee.get(r.employee_id) ?? 0, Number(r.end_minutes)));
  }

  const punches: PunchRow[] = [];
  for (const [id, rows] of candidates) {
    const end = endByEmployee.get(id);
    const shift = currentShift(rows, nowMs, tz, end ? zonedTimeToUtc(yesterday, end, tz).getTime() : null);
    if (shift.carriedOver) punches.push(...shift.punches);
  }
  return { punches, error: null };
}
