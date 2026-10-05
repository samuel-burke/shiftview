import { daysBetweenKeys, dateKeyInTz, getLocalMinutes } from "@/lib/dates";

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
