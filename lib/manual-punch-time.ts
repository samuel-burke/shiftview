import { addDaysToKey, dateKeyInTz, zonedTimeToUtc } from "@/lib/dates";

// The punch types a missed punch may close or continue from: a clock-out or
// break start follows a clock-in or break end, a break end follows a break
// start.
const FOLLOWS: Record<string, string[]> = {
  clock_out:   ["clock_in", "break_end"],
  break_start: ["clock_in", "break_end"],
  break_end:   ["break_start"],
};

// Converts a missed punch typed as a store-local date and time to an instant.
//
// The clock screen pre-fills the date of the open punch (the clock-in's day),
// so for an overnight shift — clock in Oct 13 at 22:00, forgot to clock out at
// 06:00 — the typed "Oct 13 06:00" lands eight hours *before* the clock-in.
// When the time is earlier than the open punch it follows, on that punch's own
// store day, the employee meant the next morning: roll forward one store day,
// unless that would put the punch in the future.
//
// `openPunch` is the employee's latest punch on `localDate` (store time).
export function resolveManualPunchTime(
  punchType: string,
  localDate: string,
  minutes: number,
  tz: string,
  openPunch: { punchType: string; punchedAt: string } | null,
  nowMs: number = Date.now(),
): Date {
  const ts = zonedTimeToUtc(localDate, minutes, tz);
  if (!openPunch || !FOLLOWS[punchType]?.includes(openPunch.punchType)) return ts;
  if (ts.getTime() >= Date.parse(openPunch.punchedAt)) return ts;
  if (dateKeyInTz(openPunch.punchedAt, tz) !== localDate) return ts;
  const nextDay = zonedTimeToUtc(addDaysToKey(localDate, 1), minutes, tz);
  return nextDay.getTime() <= nowMs ? nextDay : ts;
}
