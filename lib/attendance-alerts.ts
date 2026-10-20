// Proactive attendance alerts: the decisions behind /api/cron/attendance.
//
// A manager otherwise learns of a no-show only by opening a time card, of a
// forgotten clock-out only when payroll shows the day incomplete, and of
// overtime only after it is worked. The cron runs these checks every few
// minutes and alerts once per event.
//
// Pure and deterministic (every function takes `nowMs`), and built on the
// time card's own shift matching (matchSessionsToShifts / computeTimecard) so
// an alert and the time card never disagree about which shift a punch was for.

import { addDaysToKey, todayKeyInTz, weekStartForKey, zonedTimeToUtc } from "@/lib/dates";
import { computePayroll, WEEKLY_OVERTIME_THRESHOLD_HOURS, WORKWEEK_START_DAY } from "@/lib/payroll";
import type { PunchPolicy } from "@/lib/punch-policy";
import { LATE_CLOCK_OUT_GRACE_MS, MAX_SHIFT_MS } from "@/lib/punch-sessions";
import {
  computeTimecard,
  matchSessionsToShifts,
  type TimecardCalloutInput,
  type TimecardPunchInput,
  type TimecardScheduleInput,
} from "@/lib/timecard";

// Only events that became due this recently are alerted. The cron catches each
// one within minutes; the window stops a first run (or a run after an outage)
// from alerting about every no-show and forgotten clock-out of the past week.
export const ALERT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// Hours worked in a workweek past which managers are warned, whatever is
// still scheduled — 4 hours of headroom before overtime starts.
export const OVERTIME_WARNING_HOURS = 36;

const HOUR_MS = 3_600_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── No-shows ─────────────────────────────────────────────────────────────────

export type NoShow = {
  date: string;         // the shift's store day
  startMinutes: number; // its scheduled start
  startMs: number;
};

// Shifts that are no-call-no-shows at `nowMs`: exactly the time card's NCNS
// rule (no clock-in for the shift, not worked through from another one, no
// call-out, and policy.ncnsMinutes past the start), limited to ones that
// became due within ALERT_LOOKBACK_MS. `schedules` and `punches` should cover
// yesterday through tomorrow so sessions match shifts as the time card does.
export function findNoShows(input: {
  timezone: string;
  policy: PunchPolicy;
  nowMs: number;
  schedules: TimecardScheduleInput[];
  punches: TimecardPunchInput[];
  callouts: TimecardCalloutInput[];
}): NoShow[] {
  const { timezone: tz, policy, nowMs } = input;
  if (!policy.ncnsEnabled) return [];
  const today = todayKeyInTz(tz, nowMs);
  const card = computeTimecard({
    employeeId: 0,
    employeeName: "",
    from: addDaysToKey(today, -1),
    to: today,
    timezone: tz,
    policy,
    schedules: input.schedules,
    punches: input.punches,
    callouts: input.callouts,
    nowMs,
  });
  const out: NoShow[] = [];
  for (const day of card.days) {
    for (const v of day.violations) {
      if (v.type !== "ncns" || v.scheduledMinutes === undefined) continue;
      const startMs = zonedTimeToUtc(day.date, v.scheduledMinutes, tz).getTime();
      const dueMs = startMs + policy.ncnsMinutes * 60_000;
      if (nowMs - dueMs <= ALERT_LOOKBACK_MS) out.push({ date: day.date, startMinutes: v.scheduledMinutes, startMs });
    }
  }
  return out;
}

// ── Missed clock-outs ────────────────────────────────────────────────────────

export type MissedClockOut = {
  clockInId: number;
  clockInMs: number;
  // When the clock-out became overdue.
  deadlineMs: number;
  // The scheduled shift the session was for, if any.
  shift: { date: string; startMinutes: number; endMinutes: number } | null;
};

// Shifts still open (clocked in, never clocked out) past when they should have
// ended: LATE_CLOCK_OUT_GRACE_MS after the scheduled end of the shift they
// were clocked in for, or MAX_SHIFT_MS after the clock-in when no scheduled
// shift covers it. Only ones that became overdue within ALERT_LOOKBACK_MS.
export function findMissedClockOuts(input: {
  timezone: string;
  nowMs: number;
  schedules: TimecardScheduleInput[];
  punches: TimecardPunchInput[];
}): MissedClockOut[] {
  const { nowMs } = input;
  const { sessions } = matchSessionsToShifts(input);
  const out: MissedClockOut[] = [];
  for (const session of sessions) {
    const first = session.punches[0];
    const last = session.punches[session.punches.length - 1];
    if (first.punchType !== "clock_in" || last.punchType === "clock_out") continue;
    // A session clocked in after its shift ended (the time card's fallback
    // gives it the nearest shift that day) is unscheduled work.
    const shift = session.shift && session.startMs < session.shift.endMs ? session.shift : null;
    const deadlineMs = shift ? shift.endMs + LATE_CLOCK_OUT_GRACE_MS : session.startMs + MAX_SHIFT_MS;
    if (nowMs <= deadlineMs || nowMs - deadlineMs > ALERT_LOOKBACK_MS) continue;
    out.push({
      clockInId: first.id,
      clockInMs: session.startMs,
      deadlineMs,
      shift: shift && { date: shift.date, startMinutes: shift.startMinutes, endMinutes: shift.endMinutes },
    });
  }
  return out;
}

// ── Overtime ─────────────────────────────────────────────────────────────────

export type WeeklyHoursProjection = {
  weekStart: string;
  // Hours worked so far this workweek, the shift in progress included.
  workedHours: number;
  // Scheduled hours this workweek still ahead (not yet started or under way).
  remainingScheduledHours: number;
  projectedHours: number;
};

// This workweek's hours for one employee, by payroll's rules (Monday–Sunday,
// punches bucketed by lib/payroll.ts), plus what is still scheduled.
// `punches` must cover payrollQueryWindow(weekStart, today); `schedules` and
// `callouts` the workweek.
export function projectWeeklyHours(input: {
  timezone: string;
  nowMs: number;
  schedules: TimecardScheduleInput[];
  punches: TimecardPunchInput[];
  callouts: TimecardCalloutInput[];
}): WeeklyHoursProjection {
  const { timezone: tz, nowMs } = input;
  const today = todayKeyInTz(tz, nowMs);
  const weekStart = weekStartForKey(today, WORKWEEK_START_DAY);
  const weekEnd = addDaysToKey(weekStart, 6);

  // Payroll pays only completed time; the shift under way counts up to now
  // (or MAX_SHIFT_MS after its clock-in, so a forgotten clock-out doesn't
  // grow without end).
  const rows = input.punches.map((p) => ({
    id: p.id,
    employee_id: 0,
    punch_type: p.punchType,
    punched_at: p.punchedAt,
    employees: null,
  }));
  let workedMs = (computePayroll(rows, tz, { from: weekStart, to: today })[0]?.totalWorkedHours ?? 0) * HOUR_MS;

  const { shifts, sessions } = matchSessionsToShifts(input);
  const current = sessions[sessions.length - 1];
  if (current && current.ownDay >= weekStart) {
    const last = current.punches[current.punches.length - 1];
    if (last.punchType === "clock_in" || last.punchType === "break_end") {
      const openFrom = new Date(last.punchedAt).getTime();
      workedMs += Math.max(0, Math.min(nowMs, current.startMs + MAX_SHIFT_MS) - openFrom);
    }
  }

  const calledOut = new Set(input.callouts.map((c) => c.date.slice(0, 10)));
  let remainingMs = 0;
  for (const shift of shifts) {
    if (shift.date < weekStart || shift.date > weekEnd || calledOut.has(shift.date)) continue;
    // Clocked in and back out for this shift: it's done, even if it ended early.
    const lastSession = shift.sessions[shift.sessions.length - 1];
    const lastPunch = lastSession?.punches[lastSession.punches.length - 1];
    if (lastPunch?.punchType === "clock_out") continue;
    remainingMs += Math.max(0, shift.endMs - Math.max(shift.startMs, nowMs));
  }

  const workedHours = round2(workedMs / HOUR_MS);
  const remainingScheduledHours = round2(remainingMs / HOUR_MS);
  return {
    weekStart,
    workedHours,
    remainingScheduledHours,
    projectedHours: round2(workedHours + remainingScheduledHours),
  };
}

export function isApproachingOvertime(p: WeeklyHoursProjection): boolean {
  return p.projectedHours > WEEKLY_OVERTIME_THRESHOLD_HOURS || p.workedHours > OVERTIME_WARNING_HOURS;
}
