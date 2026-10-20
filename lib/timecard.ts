// Builds a manager-facing time card for one employee over a date range:
// each scheduled/worked day with its punches, hours, call-out, and the punch
// violations that day triggered under the org's configurable PunchPolicy.
//
// Pure and deterministic (accepts `nowMs` for testability). The API route at
// app/api/timecard fetches the raw rows; all interpretation lives here so the
// rules stay in one place and stay unit-testable.

import type { PunchType } from "@/data/types";
import { fmtMinutes } from "@/data/types";
import { daysBetweenKeys, dayOfWeekForKey, eachDateKey, minutesFromScheduled, zonedTimeToUtc } from "@/lib/dates";
import { assignPunchDays, MAX_SHIFT_MS } from "@/lib/punch-sessions";
import { clockInTiming, clockOutTiming, type PunchPolicy } from "@/lib/punch-policy";
import { roundPunchTimes, type RoundingMinutes } from "@/lib/pay-rules";

export type ViolationType =
  | "late_in"
  | "early_in"
  | "late_out"
  | "early_out"
  | "long_break"
  | "short_break"
  | "callout"
  | "ncns";

export type Violation = {
  type: ViolationType;
  label: string;
  detail: string;
  // Minutes over/under the configured threshold, when applicable.
  minutes?: number;
  // The punch this violation attaches to (clock-in for late/early-in, clock-out
  // for late/early-out, the break-end for long/short break). Absent for
  // day-level violations (callout, ncns) that have no originating punch.
  punchId?: number;
  // For an NCNS: the start of the shift that was missed.
  scheduledMinutes?: number;
};

export type TimecardPunchInput = {
  id: number;
  punchType: PunchType;
  punchedAt: string; // ISO timestamptz
  isManual?: boolean;
  note?: string | null;
};

export type TimecardScheduleInput = {
  date: string; // YYYY-MM-DD
  startMinutes: number;
  endMinutes: number;
};

export type TimecardCalloutInput = {
  date: string; // YYYY-MM-DD
  reason?: string | null;
};

export type TimecardPunch = {
  id: number;
  punchType: PunchType;
  punchedAt: string;
  localMinutes: number;
  isManual: boolean;
  note: string | null;
  // With punch rounding on (Settings → Pay Rules), the time payroll pays this
  // punch at; null when rounding is off or doesn't move it. punchedAt stays
  // the real time.
  roundedAt?: string | null;
};

export type TimecardDay = {
  date: string;
  dayName: string;
  // The day's first scheduled shift; `schedules` has them all (split shifts).
  schedule: { startMinutes: number; endMinutes: number } | null;
  schedules: { startMinutes: number; endMinutes: number }[];
  punches: TimecardPunch[];
  callout: { reason: string | null } | null;
  workedHours: number;
  // The day's hours from the rounded punch times; null when rounding is off.
  roundedWorkedHours: number | null;
  breakHours: number;
  breakCount: number;
  hasIncomplete: boolean;
  violations: Violation[];
};

export type Timecard = {
  employeeId: number;
  employeeName: string;
  from: string;
  to: string;
  timezone: string;
  days: TimecardDay[];
  totalWorkedHours: number;
  // Hours from the rounded punch times; null when rounding is off.
  totalRoundedWorkedHours: number | null;
  // The rounding in force (0 = exact time).
  roundingMinutes: RoundingMinutes;
  totalBreakHours: number;
  totalViolations: number;
  violationCounts: Record<ViolationType, number>;
};

// A session can belong to a shift that starts up to this long after it.
const SHIFT_MATCH_EARLY_MS = 4 * 60 * 60 * 1000;

type Session = {
  ownDay: string; // the day assignPunchDays put it on (its clock-in's day)
  startMs: number;
  endMs: number;
  punches: TimecardPunch[];
  shift: Shift | null;
};

type Shift = {
  date: string;
  startMinutes: number;
  endMinutes: number;
  startMs: number;
  endMs: number;
  sessions: Session[];
};

export type { Session as ShiftSession, Shift as ScheduledShift };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getDayName(dateStr: string): string {
  return DAY_NAMES[dayOfWeekForKey(dateStr)];
}

// Worked/break time plus every completed break's duration and the break-end
// punch that closed it (so break violations can attach to a specific punch).
function computeSegments(punches: { id: number; punchType: PunchType; punchedAt: string }[]): {
  workedMs: number;
  breakMs: number;
  breaks: { minutes: number; endPunchId: number }[];
  breakCount: number;
  hasIncomplete: boolean;
} {
  let workedMs = 0;
  let breakMs = 0;
  let segStart: number | null = null;
  let breakStart: number | null = null;
  let breakCount = 0;
  const breaks: { minutes: number; endPunchId: number }[] = [];

  // A punch that doesn't follow from the one before it (a second clock-in, a
  // clock-out with no clock-in, …) means punches are missing or doubled: count
  // what pairs up and flag the day, as lib/payroll.ts does.
  let outOfSequence = false;

  for (const p of punches) {
    const t = new Date(p.punchedAt).getTime();
    switch (p.punchType) {
      case "clock_in":
        if (segStart !== null || breakStart !== null) outOfSequence = true;
        if (breakStart !== null) { breakMs += t - breakStart; breakStart = null; }
        if (segStart === null) segStart = t;
        break;
      case "break_end":
        if (breakStart !== null) {
          const ms = t - breakStart;
          breakMs += ms;
          breaks.push({ minutes: Math.round(ms / 60_000), endPunchId: p.id });
          breakStart = null;
        } else {
          outOfSequence = true;
        }
        if (segStart === null) segStart = t;
        break;
      case "break_start":
        breakCount++;
        if (segStart !== null) { workedMs += t - segStart; segStart = null; }
        else outOfSequence = true;
        if (breakStart === null) breakStart = t;
        break;
      case "clock_out":
        if (segStart === null && breakStart === null) outOfSequence = true;
        if (segStart !== null) { workedMs += t - segStart; segStart = null; }
        if (breakStart !== null) { breakMs += t - breakStart; breakStart = null; }
        break;
    }
  }

  return {
    workedMs,
    breakMs,
    breaks,
    breakCount,
    hasIncomplete: outOfSequence || segStart !== null || breakStart !== null,
  };
}

// Turns schedules into shifts and punches into sessions, and gives each
// session to the scheduled shift it was worked for. Shared by the time card
// and the attendance alerts (lib/attendance-alerts.ts) so both judge which
// shift a punch was for the same way.
export function matchSessionsToShifts(input: {
  timezone: string;
  schedules: TimecardScheduleInput[];
  punches: TimecardPunchInput[];
}): { shifts: Shift[]; sessions: Session[] } {
  const { timezone: tz, schedules, punches } = input;

  // Scheduled shifts as real instants. A day may hold several (a split
  // shift); shifts that touch or overlap are one block of work.
  const shifts: Shift[] = [];
  for (const s of [...schedules].sort((x, y) =>
    x.date.localeCompare(y.date) || x.startMinutes - y.startMinutes)) {
    const date = s.date.slice(0, 10);
    const startMs = zonedTimeToUtc(date, s.startMinutes, tz).getTime();
    const endMs = zonedTimeToUtc(date, s.endMinutes, tz).getTime();
    const prev = shifts[shifts.length - 1];
    if (prev && prev.date === date && startMs <= prev.endMs) {
      prev.endMinutes = Math.max(prev.endMinutes, s.endMinutes);
      prev.endMs = Math.max(prev.endMs, endMs);
      continue;
    }
    shifts.push({ date, startMinutes: s.startMinutes, endMinutes: s.endMinutes, startMs, endMs, sessions: [] });
  }

  // Split the punches into sessions (a clock-in and what follows it, kept on
  // the day it started by assignPunchDays), and give each session to the
  // scheduled shift it was worked for: the one whose start is nearest among
  // those it began within SHIFT_MATCH_EARLY_MS before, and before the end of.
  // That puts a 11:50 PM clock-in for a midnight shift, or a 12:10 AM clock-in
  // for an 11 PM shift, on the shift's day, and the second half of a split
  // shift on the second shift. A session no shift claims that way goes to the
  // nearest shift on its own day, if there is one.
  // Ties (two punches stamped the same instant) keep insertion order.
  const sortedPunches = [...punches].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime() || a.id - b.id
  );
  const assigned = assignPunchDays(sortedPunches, tz);
  const sessions: Session[] = [];
  sortedPunches.forEach((p, i) => {
    const ms = new Date(p.punchedAt).getTime();
    const last = sessions[sessions.length - 1];
    const tp: TimecardPunch = {
      id: p.id,
      punchType: p.punchType,
      punchedAt: p.punchedAt,
      localMinutes: assigned[i].minutes,
      isManual: !!p.isManual,
      note: p.note ?? null,
    };
    if (!last || p.punchType === "clock_in" || assigned[i].day !== last.ownDay) {
      sessions.push({ ownDay: assigned[i].day, startMs: ms, endMs: ms, punches: [tp], shift: null });
    } else {
      last.punches.push(tp);
      last.endMs = ms;
    }
  });

  const nearest = (list: Shift[], ms: number) =>
    list.reduce<Shift | null>((best, s) =>
      !best || Math.abs(ms - s.startMs) < Math.abs(ms - best.startMs) ? s : best, null);
  for (const session of sessions) {
    const t = session.startMs;
    const shift =
      nearest(shifts.filter((s) => t >= s.startMs - SHIFT_MATCH_EARLY_MS && t < s.endMs), t) ??
      nearest(shifts.filter((s) => s.date === session.ownDay), t);
    session.shift = shift;
    shift?.sessions.push(session);
  }

  return { shifts, sessions };
}

export function computeTimecard(input: {
  employeeId: number;
  employeeName: string;
  from: string;
  to: string;
  timezone: string;
  policy: PunchPolicy;
  schedules: TimecardScheduleInput[];
  punches: TimecardPunchInput[];
  callouts: TimecardCalloutInput[];
  // Punch rounding for pay (lib/pay-rules.ts). Off by default.
  roundingMinutes?: RoundingMinutes;
  nowMs?: number;
}): Timecard {
  const { employeeId, employeeName, from, to, timezone: tz, policy, schedules, punches, callouts } = input;
  const nowMs = input.nowMs ?? Date.now();
  const rounding = input.roundingMinutes ?? 0;

  // Rounded times over the whole punch sequence, as payroll rounds them.
  const roundedById = new Map<number, number>();
  if (rounding) {
    const ordered = [...punches].sort(
      (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime() || a.id - b.id
    );
    const ms = roundPunchTimes(
      ordered.map((p) => ({ punchType: p.punchType, ms: new Date(p.punchedAt).getTime() })),
      rounding,
      tz,
    );
    ordered.forEach((p, i) => roundedById.set(p.id, ms[i]));
  }

  const calloutByDate = new Map<string, TimecardCalloutInput>();
  for (const c of callouts) calloutByDate.set(c.date.slice(0, 10), c);

  const { shifts, sessions } = matchSessionsToShifts({ timezone: tz, schedules, punches });

  // When a session ends: its last punch, or for one still open, up to 16 hours
  // (the longest shift) after it began.
  const sessionEndMs = (x: Session) =>
    x.punches[x.punches.length - 1].punchType === "clock_out"
      ? x.endMs
      : Math.max(x.endMs, Math.min(nowMs, x.startMs + MAX_SHIFT_MS));

  const punchesByDate = new Map<string, TimecardPunch[]>();
  for (const session of sessions) {
    const day = session.shift?.date ?? session.ownDay;
    const offset = 1440 * daysBetweenKeys(day, session.ownDay);
    const arr = punchesByDate.get(day) ?? [];
    for (const p of session.punches) {
      const r = roundedById.get(p.id);
      const roundedAt = rounding && r !== undefined && r !== new Date(p.punchedAt).getTime() ? new Date(r).toISOString() : null;
      arr.push({ ...p, localMinutes: p.localMinutes + offset, ...(rounding ? { roundedAt } : {}) });
    }
    punchesByDate.set(day, arr);
  }

  const shiftsByDate = new Map<string, Shift[]>();
  for (const s of shifts) shiftsByDate.set(s.date, [...(shiftsByDate.get(s.date) ?? []), s]);

  const violationCounts: Record<ViolationType, number> = {
    late_in: 0, early_in: 0, late_out: 0, early_out: 0,
    long_break: 0, short_break: 0, callout: 0, ncns: 0,
  };
  let totalWorkedMs = 0; // summed exactly, rounded once
  let totalRoundedMs = 0;
  let totalBreakMs = 0;
  const days: TimecardDay[] = [];

  for (const date of eachDateKey(from, to)) {
    const dayShifts = shiftsByDate.get(date) ?? [];
    const callout = calloutByDate.get(date) ?? null;
    const dayPunches = (punchesByDate.get(date) ?? []).sort(
      (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime() || a.id - b.id
    );

    // Skip days with nothing to show (no schedule, no punches, no call-out).
    if (dayShifts.length === 0 && dayPunches.length === 0 && !callout) continue;

    const { workedMs, breakMs, breaks, breakCount, hasIncomplete } = computeSegments(dayPunches);
    const workedHours = round2(workedMs / 3_600_000);
    const breakHours = round2(breakMs / 3_600_000);
    totalWorkedMs += workedMs;
    totalBreakMs += breakMs;
    let roundedWorkedHours: number | null = null;
    if (rounding) {
      const roundedMs = computeSegments(dayPunches.map((p) => ({ ...p, punchedAt: p.roundedAt ?? p.punchedAt }))).workedMs;
      totalRoundedMs += roundedMs;
      roundedWorkedHours = round2(roundedMs / 3_600_000);
    }

    const violations: Violation[] = [];
    const add = (v: Violation) => { violations.push(v); violationCounts[v.type]++; };

    // Call-out takes precedence — a called-out day is never also NCNS.
    if (callout) {
      add({
        type: "callout",
        label: "Call Out",
        detail: callout.reason?.trim() ? `Called out: ${callout.reason.trim()}` : "Called out",
      });
    }

    for (const shift of dayShifts) {
      const shiftPunches = shift.sessions.flatMap((s) => s.punches);
      const firstClockIn = shiftPunches.find((p) => p.punchType === "clock_in") ?? null;
      const lastClockOut = [...shiftPunches].reverse().find((p) => p.punchType === "clock_out") ?? null;

      // Clock-in timing vs. scheduled start.
      if (firstClockIn) {
        // Real elapsed minutes, so a shift that starts in a DST-repeated or
        // -skipped hour is judged correctly.
        const diff = minutesFromScheduled(firstClockIn.punchedAt, date, shift.startMinutes, tz);
        const timing = clockInTiming(policy, diff);
        if (timing === "late") {
          add({
            type: "late_in",
            label: "Late In",
            detail: `Clocked in ${diff} min late (scheduled ${fmtMinutes(shift.startMinutes)})`,
            minutes: diff,
            punchId: firstClockIn.id,
          });
        } else if (timing === "early") {
          add({
            type: "early_in",
            label: "Early In",
            detail: `Clocked in ${-diff} min early (scheduled ${fmtMinutes(shift.startMinutes)})`,
            minutes: -diff,
            punchId: firstClockIn.id,
          });
        }
      }

      // Clock-out timing vs. scheduled end.
      if (lastClockOut) {
        const diff = minutesFromScheduled(lastClockOut.punchedAt, date, shift.endMinutes, tz);
        const timing = clockOutTiming(policy, diff);
        if (timing === "late") {
          add({
            type: "late_out",
            label: "Late Out",
            detail: `Clocked out ${diff} min late (scheduled ${fmtMinutes(shift.endMinutes)})`,
            minutes: diff,
            punchId: lastClockOut.id,
          });
        } else if (timing === "early") {
          add({
            type: "early_out",
            label: "Early Out",
            detail: `Clocked out ${-diff} min early (scheduled ${fmtMinutes(shift.endMinutes)})`,
            minutes: -diff,
            punchId: lastClockOut.id,
          });
        }
      }

      // No call, no show — scheduled, never clocked in, never called out, and
      // the grace window past the scheduled start has elapsed.
      // A shift worked through from another one (no clock-out between) counts.
      const workedThrough = sessions.some((x) => x.startMs < shift.endMs && sessionEndMs(x) > shift.startMs);
      if (policy.ncnsEnabled && !firstClockIn && !workedThrough && !callout &&
          nowMs - shift.startMs > policy.ncnsMinutes * 60_000) {
        add({
          type: "ncns",
          label: "No Call No Show",
          detail: `No clock-in and no call-out for ${fmtMinutes(shift.startMinutes)} shift`,
          scheduledMinutes: shift.startMinutes,
        });
      }
    }

    // Break length — one violation per offending break, attached to the
    // break-end punch that closed it.
    for (const { minutes: mins, endPunchId } of breaks) {
      if (policy.longBreakEnabled && mins > policy.longBreakMinutes) {
        add({
          type: "long_break",
          label: "Long Break",
          detail: `${mins} min break (limit ${policy.longBreakMinutes} min)`,
          minutes: mins,
          punchId: endPunchId,
        });
      } else if (policy.shortBreakEnabled && mins < policy.shortBreakMinutes) {
        add({
          type: "short_break",
          label: "Short Break",
          detail: `${mins} min break (minimum ${policy.shortBreakMinutes} min)`,
          minutes: mins,
          punchId: endPunchId,
        });
      }
    }

    const daySchedules = dayShifts.map((s) => ({ startMinutes: s.startMinutes, endMinutes: s.endMinutes }));
    days.push({
      date,
      dayName: getDayName(date),
      schedule: daySchedules[0] ?? null,
      schedules: daySchedules,
      punches: dayPunches,
      callout: callout ? { reason: callout.reason ?? null } : null,
      workedHours,
      roundedWorkedHours,
      breakHours,
      breakCount,
      hasIncomplete,
      violations,
    });
  }

  const totalViolations = Object.values(violationCounts).reduce((s, n) => s + n, 0);

  return {
    employeeId,
    employeeName,
    from,
    to,
    timezone: tz,
    days,
    totalWorkedHours: round2(totalWorkedMs / 3_600_000),
    totalRoundedWorkedHours: rounding ? round2(totalRoundedMs / 3_600_000) : null,
    roundingMinutes: rounding,
    totalBreakHours: round2(totalBreakMs / 3_600_000),
    totalViolations,
    violationCounts,
  };
}
