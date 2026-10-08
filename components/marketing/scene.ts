// The sample store at one moment, for the marketing previews. Everything comes
// from the live demo's own data (data/demo-fixtures.ts): the roster, the
// published week, store hours and the coverage target, on the store's today.
// Punches look like a real day's: a few minutes either side of each shift,
// staggered 30-minute breaks. One moment is scripted: whoever starts at 1:00 PM
// (10:00 AM on weekends) clocks in 10 minutes late, which trips the app's
// "Late Clock-In" alert to managers and clears its coverage warning.
//
// Times are seconds since the store's midnight.

import {
  DEMO_COVERAGE_DEFAULTS,
  DEMO_COVERAGE_PROFILES,
  DEMO_EMPLOYEES,
  DEMO_SETTINGS,
  DEMO_STORE_HOURS,
  EMPLOYEE_PATTERNS,
} from "@/data/demo-fixtures";
import { addDaysToKey, dayOfWeekForKey, eachDateKey, zonedTimeToUtc } from "@/lib/dates";
import { liveCoverageStatus, targetAt, type CoverageBlock, type LiveCoverageStatus } from "@/lib/coverage";
import { DEFAULT_PUNCH_POLICY } from "@/lib/punch-policy";
import { computeTimecard, type Timecard, type TimecardPunchInput } from "@/lib/timecard";
import { getShiftType, type AttendanceStatus, type Employee, type PunchType, type Schedule, type ShiftType, type StoreHours } from "@/data/types";

export type ScenePunch = { employeeId: number; type: PunchType; at: number };

export type Scene = {
  date: string;
  hours: StoreHours;
  curve: CoverageBlock[];
  /** The whole roster, in the order /api/employees returns it (by last name). */
  employees: Employee[];
  shifts: Schedule[];
  punches: ScenePunch[];
  /** The shift whose person clocks in late, and when they do. */
  late: { shift: Schedule; at: number };
};

/** Jordan Martinez, the store manager the demo signs visitors in as. */
export const MANAGER_ID = 1;
const LATE_BY = 10 * 60;
const BREAK = 30 * 60;

const lastName = (name: string) => name.trim().split(/\s+/).at(-1)!;
const ROSTER = [...DEMO_EMPLOYEES].sort(
  (a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name)
);

// Deterministic per person: "random" seconds that come out the same on the
// server and in every browser (integer math only), so hydration matches.
function jitter(id: number, salt: number, min: number, max: number): number {
  const h = (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  return min + (h % (max - min + 1));
}

export function buildScene(date: string): Scene {
  const dow = dayOfWeekForKey(date);
  const hours = DEMO_STORE_HOURS[dow];
  const curve = DEMO_COVERAGE_PROFILES.find((p) => p.id === DEMO_COVERAGE_DEFAULTS[dow])?.blocks ?? [];
  const shifts: Schedule[] = DEMO_EMPLOYEES.flatMap((e) => {
    const s = EMPLOYEE_PATTERNS[e.id]?.[dow];
    return s ? [{ id: 100 + e.id, employeeId: e.id, date, startMinutes: s[0], endMinutes: s[1] }] : [];
  }).sort((a, b) => a.startMinutes - b.startMinutes || a.employeeId - b.employeeId);

  // The latest start up to 1:00 PM; of those, the shortest shift.
  const lateShift = shifts
    .filter((s) => s.startMinutes <= 780)
    .sort((a, b) => b.startMinutes - a.startMinutes || (a.endMinutes - a.startMinutes) - (b.endMinutes - b.startMinutes) || a.employeeId - b.employeeId)[0];
  const lateAt = lateShift.startMinutes * 60 + LATE_BY + 5;

  const punches: ScenePunch[] = [];
  // Breaks for shifts of 6 hours or more, staggered so the floor is never
  // short two people at once: the first opener goes 2.5 hours in, each next
  // person 45 minutes after the one before.
  let nextBreak = 0;
  for (const s of shifts) {
    const id = s.employeeId;
    const start = s.startMinutes * 60;
    const end = s.endMinutes * 60;
    punches.push({ employeeId: id, type: "clock_in", at: s === lateShift ? lateAt : start + jitter(id, 1, -240, 100) });
    if (end - start >= 6 * 3600) {
      const at = Math.max(start + 150 * 60, nextBreak) + jitter(id, 2, 0, 50);
      nextBreak = at + 45 * 60;
      punches.push({ employeeId: id, type: "break_start", at });
      punches.push({ employeeId: id, type: "break_end", at: at + BREAK + jitter(id, 3, 0, 80) });
    }
    punches.push({ employeeId: id, type: "clock_out", at: end + jitter(id, 4, 0, 300) });
  }
  punches.sort((a, b) => a.at - b.at);

  return { date, hours, curve, employees: ROSTER, shifts, punches, late: { shift: lateShift, at: lateAt } };
}

/** Someone's published shift on any date, from the weekly pattern. */
export function shiftFor(employeeId: number, date: string): Schedule | null {
  const s = EMPLOYEE_PATTERNS[employeeId]?.[dayOfWeekForKey(date)];
  return s ? { id: Number(date.replaceAll("-", "")) * 100 + employeeId, employeeId, date, startMinutes: s[0], endMinutes: s[1] } : null;
}

/** Their next shift after `date`. */
export function nextShiftAfter(employeeId: number, date: string): Schedule | null {
  for (let i = 1; i <= 7; i++) {
    const s = shiftFor(employeeId, addDaysToKey(date, i));
    if (s) return s;
  }
  return null;
}

// ── Reading the scene at a moment ──────────────────────────────

export function punchesOf(scene: Scene, employeeId: number, t: number): ScenePunch[] {
  return scene.punches.filter((p) => p.employeeId === employeeId && p.at <= t);
}

export function statusAt(scene: Scene, employeeId: number, t: number): AttendanceStatus {
  const last = punchesOf(scene, employeeId, t).at(-1);
  if (!last) return "not_clocked_in";
  return last.type === "clock_in" || last.type === "break_end" ? "clocked_in" : last.type === "break_start" ? "on_break" : "clocked_out";
}

export function attendanceAt(scene: Scene, t: number): Record<number, AttendanceStatus> {
  return Object.fromEntries(scene.shifts.map((s) => [s.employeeId, statusAt(scene, s.employeeId, t)]));
}

/** Clocked in right now (not on break), as the dashboard's Here Now counts it. */
export function hereAt(scene: Scene, t: number): number {
  return scene.shifts.filter((s) => statusAt(scene, s.employeeId, t) === "clocked_in").length;
}

export function coverageAt(scene: Scene, t: number): LiveCoverageStatus | "closed" {
  const minute = Math.floor(t / 60);
  if (minute < scene.hours.open || minute >= scene.hours.close) return "closed";
  return liveCoverageStatus(hereAt(scene, t), targetAt(scene.curve, minute));
}

/** Seconds worked today: clock-in to now, less breaks. */
export function workedAt(scene: Scene, employeeId: number, t: number): number {
  let total = 0;
  let since: number | null = null;
  for (const p of punchesOf(scene, employeeId, t)) {
    if (p.type === "clock_in" || p.type === "break_end") since = p.at;
    else if (since !== null) { total += p.at - since; since = null; }
  }
  return since === null ? total : total + (t - since);
}

export function shiftTypeOf(scene: Scene, s: Schedule): ShiftType {
  return getShiftType(s.startMinutes, s.endMinutes, scene.hours.open, scene.hours.close) ?? "mid";
}

export function employeeOf(scene: Scene, id: number): Employee {
  return scene.employees.find((e) => e.id === id)!;
}

/** 1:10 PM, as the phone's status bar shows the time. */
export function statusBarTime(t: number): string {
  const h = Math.floor(t / 3600) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}`;
}

/** 01:10:05 PM, as the clock screen lists punches. */
export function punchTime(t: number): string {
  const h = Math.floor(t / 3600) % 24;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)} ${h < 12 ? "AM" : "PM"}`;
}

// ── Time cards ──────────────────────────────────────────────

/** The store's wall-clock time `t` on `date`, as an ISO instant. */
function instant(date: string, t: number): string {
  return new Date(zonedTimeToUtc(date, Math.floor(t / 60), DEMO_SETTINGS.timezone).getTime() + (t % 60) * 1000).toISOString();
}

/**
 * The punches `employeeId` made on an earlier day, like a real week's: in a
 * few minutes either side of the start, a half-hour break mid-shift on shifts
 * of 6 hours or more, out just after the end. `forgotOut` is the day they
 * forgot to clock out and sent a correction, which their manager approved:
 * the app records it as a manual clock-out at the shift's end.
 */
function pastPunches(employeeId: number, date: string, shift: Schedule, forgotOut: boolean): Omit<TimecardPunchInput, "id">[] {
  const salt = Number(date.slice(5, 7)) * 31 + Number(date.slice(8));
  const start = shift.startMinutes * 60;
  const end = shift.endMinutes * 60;
  const out: Omit<TimecardPunchInput, "id">[] = [{ punchType: "clock_in", punchedAt: instant(date, start + jitter(employeeId, salt * 4, -240, 100)) }];
  if (end - start >= 6 * 3600) {
    const at = start + Math.round((end - start) * 0.45) + jitter(employeeId, salt * 4 + 1, -600, 600);
    out.push({ punchType: "break_start", punchedAt: instant(date, at) });
    out.push({ punchType: "break_end", punchedAt: instant(date, at + BREAK + jitter(employeeId, salt * 4 + 2, 0, 120)) });
  }
  out.push(
    forgotOut
      ? { punchType: "clock_out", punchedAt: instant(date, end), isManual: true, note: "Forgot to clock out" }
      : { punchType: "clock_out", punchedAt: instant(date, end + jitter(employeeId, salt * 4 + 3, 0, 300)) }
  );
  return out;
}

/**
 * `employeeId`'s time card as the app builds it when a manager opens it at
 * `t` today: the last 14 days, the store's punch rules (the defaults), and
 * every punch, with today's from the scene. lib/timecard does the rest.
 */
export function timecardAt(scene: Scene, employeeId: number, t: number): Timecard {
  const from = addDaysToKey(scene.date, -13);
  const shifts = eachDateKey(from, scene.date).flatMap((d) => {
    const s = shiftFor(employeeId, d);
    return s ? [s] : [];
  });
  const past = shifts.filter((s) => s.date < scene.date);
  // The third-latest of those days is the one with the forgotten clock-out.
  const forgot = past.at(-3)?.date;
  const punches = [
    ...past.flatMap((s) => pastPunches(employeeId, s.date, s, s.date === forgot)),
    ...punchesOf(scene, employeeId, t).map((p) => ({ punchType: p.type, punchedAt: instant(scene.date, p.at) })),
  ].map((p, i) => ({ id: i + 1, ...p }));
  return computeTimecard({
    employeeId,
    employeeName: employeeOf(scene, employeeId).name,
    from,
    to: scene.date,
    timezone: DEMO_SETTINGS.timezone,
    policy: DEFAULT_PUNCH_POLICY,
    schedules: shifts.map((s) => ({ date: s.date, startMinutes: s.startMinutes, endMinutes: s.endMinutes })),
    punches,
    callouts: [],
    nowMs: Date.parse(instant(scene.date, t)),
  });
}
