// Builds a manager-facing time card for one employee over a date range:
// each scheduled/worked day with its punches, hours, call-out, and the punch
// violations that day triggered under the org's configurable PunchPolicy.
//
// Pure and deterministic (accepts `nowMs` for testability). The API route at
// app/api/timecard fetches the raw rows; all interpretation lives here so the
// rules stay in one place and stay unit-testable.

import type { PunchType } from "@/data/types";
import { fmtMinutes } from "@/data/types";
import { getLocalMinutes, localDayBoundsUtc } from "@/lib/punch-date-utils";
import type { PunchPolicy } from "@/lib/punch-policy";

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
};

export type TimecardDay = {
  date: string;
  dayName: string;
  schedule: { startMinutes: number; endMinutes: number } | null;
  punches: TimecardPunch[];
  callout: { reason: string | null } | null;
  workedHours: number;
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
  totalBreakHours: number;
  totalViolations: number;
  violationCounts: Record<ViolationType, number>;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getDayName(dateStr: string): string {
  return DAY_NAMES[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}

// Inclusive list of YYYY-MM-DD dates from `from` to `to` (noon-UTC anchored to
// dodge DST midnight edges).
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(to + "T12:00:00Z");
  for (let d = new Date(from + "T12:00:00Z"); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
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

  for (const p of punches) {
    const t = new Date(p.punchedAt).getTime();
    switch (p.punchType) {
      case "clock_in":
        segStart = t;
        break;
      case "break_end":
        if (breakStart !== null) {
          const ms = t - breakStart;
          breakMs += ms;
          breaks.push({ minutes: Math.round(ms / 60_000), endPunchId: p.id });
          breakStart = null;
        }
        segStart = t;
        break;
      case "break_start":
        breakCount++;
        if (segStart !== null) { workedMs += t - segStart; segStart = null; }
        breakStart = t;
        break;
      case "clock_out":
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
    hasIncomplete: segStart !== null || breakStart !== null,
  };
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
  nowMs?: number;
}): Timecard {
  const { employeeId, employeeName, from, to, timezone: tz, policy, schedules, punches, callouts } = input;
  const nowMs = input.nowMs ?? Date.now();

  const scheduleByDate = new Map<string, TimecardScheduleInput>();
  for (const s of schedules) scheduleByDate.set(s.date.slice(0, 10), s);

  const calloutByDate = new Map<string, TimecardCalloutInput>();
  for (const c of callouts) calloutByDate.set(c.date.slice(0, 10), c);

  // Bucket punches by their local calendar day.
  const punchesByDate = new Map<string, TimecardPunch[]>();
  for (const p of punches) {
    const when = new Date(p.punchedAt);
    const dateKey = when.toLocaleDateString("en-CA", { timeZone: tz });
    const tp: TimecardPunch = {
      id: p.id,
      punchType: p.punchType,
      punchedAt: p.punchedAt,
      localMinutes: getLocalMinutes(when, tz),
      isManual: !!p.isManual,
      note: p.note ?? null,
    };
    const arr = punchesByDate.get(dateKey) ?? [];
    arr.push(tp);
    punchesByDate.set(dateKey, arr);
  }

  const violationCounts: Record<ViolationType, number> = {
    late_in: 0, early_in: 0, late_out: 0, early_out: 0,
    long_break: 0, short_break: 0, callout: 0, ncns: 0,
  };
  let totalWorkedHours = 0;
  let totalBreakHours = 0;
  const days: TimecardDay[] = [];

  for (const date of eachDate(from, to)) {
    const schedule = scheduleByDate.get(date) ?? null;
    const callout = calloutByDate.get(date) ?? null;
    const dayPunches = (punchesByDate.get(date) ?? []).sort(
      (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
    );

    // Skip days with nothing to show (no schedule, no punches, no call-out).
    if (!schedule && dayPunches.length === 0 && !callout) continue;

    const { workedMs, breakMs, breaks, breakCount, hasIncomplete } = computeSegments(dayPunches);
    const workedHours = round2(workedMs / 3_600_000);
    const breakHours = round2(breakMs / 3_600_000);
    totalWorkedHours += workedHours;
    totalBreakHours += breakHours;

    const violations: Violation[] = [];
    const add = (v: Violation) => { violations.push(v); violationCounts[v.type]++; };

    const firstClockIn = dayPunches.find((p) => p.punchType === "clock_in") ?? null;
    const lastClockOut = [...dayPunches].reverse().find((p) => p.punchType === "clock_out") ?? null;

    // Call-out takes precedence — a called-out day is never also NCNS.
    if (callout) {
      add({
        type: "callout",
        label: "Call Out",
        detail: callout.reason?.trim() ? `Called out: ${callout.reason.trim()}` : "Called out",
      });
    }

    // Clock-in timing vs. scheduled start.
    if (schedule && firstClockIn) {
      const diff = firstClockIn.localMinutes - schedule.startMinutes;
      if (policy.lateInEnabled && diff > policy.lateInMinutes) {
        add({
          type: "late_in",
          label: "Late In",
          detail: `Clocked in ${diff} min late (scheduled ${fmtMinutes(schedule.startMinutes)})`,
          minutes: diff,
          punchId: firstClockIn.id,
        });
      } else if (policy.earlyInEnabled && -diff > policy.earlyInMinutes) {
        add({
          type: "early_in",
          label: "Early In",
          detail: `Clocked in ${-diff} min early (scheduled ${fmtMinutes(schedule.startMinutes)})`,
          minutes: -diff,
          punchId: firstClockIn.id,
        });
      }
    }

    // Clock-out timing vs. scheduled end.
    if (schedule && lastClockOut) {
      const diff = lastClockOut.localMinutes - schedule.endMinutes;
      if (policy.lateOutEnabled && diff > policy.lateOutMinutes) {
        add({
          type: "late_out",
          label: "Late Out",
          detail: `Clocked out ${diff} min late (scheduled ${fmtMinutes(schedule.endMinutes)})`,
          minutes: diff,
          punchId: lastClockOut.id,
        });
      } else if (policy.earlyOutEnabled && -diff > policy.earlyOutMinutes) {
        add({
          type: "early_out",
          label: "Early Out",
          detail: `Clocked out ${-diff} min early (scheduled ${fmtMinutes(schedule.endMinutes)})`,
          minutes: -diff,
          punchId: lastClockOut.id,
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

    // No call, no show — scheduled, never clocked in, never called out, and the
    // grace window past the scheduled start has elapsed.
    if (policy.ncnsEnabled && schedule && !firstClockIn && !callout) {
      const { start } = localDayBoundsUtc(date, tz);
      const startInstantMs = start.getTime() + schedule.startMinutes * 60_000;
      if (nowMs - startInstantMs > policy.ncnsMinutes * 60_000) {
        add({
          type: "ncns",
          label: "No Call No Show",
          detail: `No clock-in and no call-out for ${fmtMinutes(schedule.startMinutes)} shift`,
        });
      }
    }

    days.push({
      date,
      dayName: getDayName(date),
      schedule: schedule ? { startMinutes: schedule.startMinutes, endMinutes: schedule.endMinutes } : null,
      punches: dayPunches,
      callout: callout ? { reason: callout.reason ?? null } : null,
      workedHours,
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
    totalWorkedHours: round2(totalWorkedHours),
    totalBreakHours: round2(totalBreakHours),
    totalViolations,
    violationCounts,
  };
}
