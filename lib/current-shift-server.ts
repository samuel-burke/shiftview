import { addDaysToKey, localDayBoundsUtc, todayKeyInTz } from "@/lib/dates";
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
  return { shift: currentShift(rows, nowMs, tz), error: null };
}
