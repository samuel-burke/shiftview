import { addDaysToKey, dateKeyInTz, todayKeyInTz } from "@/lib/dates";

type QueryClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type PunchSchedule = {
  id: number;
  employee_id: number;
  date: string;
  start_minutes: number;
  end_minutes: number;
};

// A punch's scheduleId is optional, but when given it must be a positive
// integer id — never a string, float or object that a query would coerce.
export function isScheduleIdInput(value: unknown): value is number | null | undefined {
  return value == null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}

// The shift, if it is this employee's own in this org. Anything else (another
// employee's shift, another org's, a guessed id) reads as missing.
export async function loadOwnSchedule(
  supabase: QueryClient,
  orgId: string,
  employeeId: number,
  scheduleId: number,
): Promise<PunchSchedule | null> {
  const { data } = await supabase
    .from("schedules")
    .select("id, employee_id, date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("id", scheduleId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  return (data as PunchSchedule | null) ?? null;
}

// A shift can be attached to a punch on its own store day or the day either
// side (an overnight shift's clock-out, an early clock-in just before
// midnight). Migration 0043 enforces the same window in the database.
export function isShiftNearPunch(shift: Pick<PunchSchedule, "date">, punchedAt: Date | string | number, tz: string): boolean {
  const punchDay = dateKeyInTz(punchedAt, tz);
  return shift.date >= addDaysToKey(punchDay, -1) && shift.date <= addDaysToKey(punchDay, 1);
}

// A live clock-in may start today's shift, or yesterday's overnight shift
// (one that runs past midnight) — the shifts the clock screen offers.
export function isClockInShift(shift: Pick<PunchSchedule, "date" | "end_minutes">, tz: string, nowMs: number = Date.now()): boolean {
  const today = todayKeyInTz(tz, nowMs);
  if (shift.date === today) return true;
  return shift.date === addDaysToKey(today, -1) && shift.end_minutes > 1440;
}
