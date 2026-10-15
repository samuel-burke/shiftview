import { addDaysToKey, dateKeyInTz, todayKeyInTz, zonedTimeToUtc } from "@/lib/dates";
import { LATE_CLOCK_OUT_GRACE_MS } from "@/lib/punch-sessions";

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

// A live clock-in may start today's shift (even late), or yesterday's
// overnight shift (one that runs past midnight) while it is still running or
// within LATE_CLOCK_OUT_GRACE_MS of its end — the window in which the current
// shift still treats it as open. Once that has passed, a clock-in this morning
// is for today's work and must not be booked against last night's shift.
export function isClockInShift(shift: Pick<PunchSchedule, "date" | "end_minutes">, tz: string, nowMs: number = Date.now()): boolean {
  const today = todayKeyInTz(tz, nowMs);
  if (shift.date === today) return true;
  if (shift.date !== addDaysToKey(today, -1) || shift.end_minutes <= 1440) return false;
  return nowMs < zonedTimeToUtc(shift.date, shift.end_minutes, tz).getTime() + LATE_CLOCK_OUT_GRACE_MS;
}

type DatedShift = { employeeId: number; date: string; startMinutes: number; endMinutes: number };

// The shift a clock-in right now is for, out of the employee's shifts today
// and yesterday: the one running now, else the next one to start, else the
// one that ended most recently. With a split shift (8–12 and 4–8) a 4 PM
// clock-in is for the afternoon shift — not the morning one, which would read
// as eight hours late. Only shifts the server accepts a clock-in for
// (isClockInShift) are considered.
export function pickClockInShift<S extends DatedShift>(
  empId: number | null | undefined,
  shifts: S[],
  tz: string,
  nowMs: number = Date.now(),
): S | null {
  if (!empId) return null;
  const candidates = shifts
    .filter((s) => s.employeeId === empId)
    .filter((s) => isClockInShift({ date: s.date.slice(0, 10), end_minutes: s.endMinutes }, tz, nowMs))
    .map((s) => ({
      shift: s,
      startMs: zonedTimeToUtc(s.date, s.startMinutes, tz).getTime(),
      endMs: zonedTimeToUtc(s.date, s.endMinutes, tz).getTime(),
    }));
  const running = candidates
    .filter((c) => c.startMs <= nowMs && nowMs < c.endMs)
    .sort((a, b) => b.startMs - a.startMs)[0];
  if (running) return running.shift;
  const next = candidates.filter((c) => c.startMs > nowMs).sort((a, b) => a.startMs - b.startMs)[0];
  if (next) return next.shift;
  const ended = candidates.filter((c) => c.endMs <= nowMs).sort((a, b) => b.endMs - a.endMs)[0];
  return ended?.shift ?? null;
}
