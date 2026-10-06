import { addDaysToKey, daysBetweenKeys, dateKeyInTz, getLocalMinutes, todayKeyInTz } from "@/lib/dates";

// A session that runs this long without a clock-out is treated as abandoned
// (a forgotten clock-out) rather than continuing into later punches.
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

export type PunchDayAssignment = {
  // The store-local work day the punch belongs to: the day its session's
  // clock-in fell on, so a shift that runs past midnight stays on one day.
  day: string;
  // Minutes since midnight of `day` (may exceed 1440 for post-midnight punches).
  minutes: number;
};

// Assign each punch (already sorted chronologically) to a work day in `tz`.
export function assignPunchDays(
  punches: { punchType: string; punchedAt: string }[],
  tz: string,
): PunchDayAssignment[] {
  let sessionDay: string | null = null;
  let sessionStartMs = 0;

  return punches.map((p) => {
    const t = new Date(p.punchedAt).getTime();
    const ownDay = dateKeyInTz(t, tz);
    if (p.punchType === "clock_in" || (sessionDay !== null && t - sessionStartMs > MAX_SESSION_MS)) {
      sessionDay = p.punchType === "clock_in" ? ownDay : null;
      sessionStartMs = t;
    }
    const day = sessionDay ?? ownDay;
    const minutes = getLocalMinutes(t, tz) + 1440 * daysBetweenKeys(day, ownDay);
    if (p.punchType === "clock_out") sessionDay = null;
    return { day, minutes };
  });
}

// ── The current shift, across midnight ───────────────────────────────────────
// The clock works in store calendar days, but a shift can run past midnight —
// a closer staying late, or a scheduled overnight shift. A shift left open
// from the previous store day is still the *current* shift — so its owner can
// take/end a break and clock out normally — until whichever is later:
//   * OVERNIGHT_GRACE_MINUTES past the store's midnight (a late close), or
//   * LATE_CLOCK_OUT_GRACE_MS after the end of a scheduled overnight shift;
// and only while it's within MAX_SHIFT_MS (+ that grace) of its clock-in.
// After that it's treated as a forgotten clock-out (the missed-punch flow), so
// it never blocks the next day's clock-in.

export const OVERNIGHT_GRACE_MINUTES = 4 * 60; // until 4:00 AM store time
export const LATE_CLOCK_OUT_GRACE_MS = 2 * 60 * 60 * 1000;
export const MAX_SHIFT_MS = 16 * 60 * 60 * 1000; // longest allowed shift (BR-3)

type SessionPunch = { punchType: string; punchedAt: string };

export type CurrentShift<P extends SessionPunch> = {
  // The latest punch type of the current shift, or null when there is none
  // (never clocked in, or the shift was left open on a previous day).
  state: string | null;
  // Punches from the current shift's clock-in onward (empty when state is null).
  punches: P[];
  // True while the current shift is still open and began on the previous store day.
  carriedOver: boolean;
};

// `punches`: the employee's punches from the start of the previous store day
// up to now, sorted ascending. `overnightEndMs`: when the employee has an
// overnight shift scheduled to start yesterday, the instant it ends.
export function currentShift<P extends SessionPunch>(
  punches: P[],
  nowMs: number,
  tz: string,
  overnightEndMs: number | null = null,
): CurrentShift<P> {
  const today = todayKeyInTz(tz, nowMs);
  const sinceLastClockIn = (list: P[]) => {
    const i = list.map((p) => p.punchType).lastIndexOf("clock_in");
    return i >= 0 ? list.slice(i) : [];
  };
  const startedBeforeToday = (session: P[]) =>
    session.length > 0 && dateKeyInTz(session[0].punchedAt, tz) < today;

  const todays = punches.filter((p) => dateKeyInTz(p.punchedAt, tz) === today);
  if (todays.length > 0) {
    const session = sinceLastClockIn(punches);
    const state = todays[todays.length - 1].punchType;
    return {
      state,
      punches: session,
      carriedOver: state !== "clock_out" && startedBeforeToday(session) && todays.every((p) => p.punchType !== "clock_in"),
    };
  }

  // Nothing yet today: is yesterday's shift still open and within the grace window?
  const last = punches[punches.length - 1];
  const session = sinceLastClockIn(punches);
  const clockIn = session[0];
  const scheduledOvernight = overnightEndMs !== null && nowMs <= overnightEndMs + LATE_CLOCK_OUT_GRACE_MS;
  const withinGrace = getLocalMinutes(nowMs, tz) < OVERNIGHT_GRACE_MINUTES || scheduledOvernight;
  const maxAgeMs = scheduledOvernight ? MAX_SHIFT_MS + LATE_CLOCK_OUT_GRACE_MS : MAX_SHIFT_MS;
  const open =
    !!last && last.punchType !== "clock_out" &&
    !!clockIn && dateKeyInTz(clockIn.punchedAt, tz) === addDaysToKey(today, -1) &&
    withinGrace &&
    nowMs - new Date(clockIn.punchedAt).getTime() <= maxAgeMs;
  return open
    ? { state: last.punchType, punches: session, carriedOver: true }
    : { state: null, punches: [], carriedOver: false };
}
