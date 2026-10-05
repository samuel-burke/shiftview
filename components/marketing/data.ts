import { DEMO_EMPLOYEES, EMPLOYEE_PATTERNS } from "@/data/demo-fixtures";
import { getShiftType, formatDisplayName, type ShiftType } from "@/data/types";

// ── Product snapshot ────────────────────────────────────────
// Every screen on this page is rendered from the same seed data the live demo
// uses (data/demo-fixtures.ts) and the same helpers the app uses, so the
// previews stay honest: a Saturday at 1:30 PM in the Demo organization.

export const DAY_OF_WEEK = 6; // Saturday
export const OPEN = 360; // 6:00 AM
export const CLOSE = 1320; // 10:00 PM
export const NOW = 810; // 1:30 PM

export type Attendance = "clocked_in" | "on_break" | "not_clocked_in" | "upcoming";

// Who's on break / running late in the snapshot. Everyone else whose shift has
// started is clocked in on time.
export const ATTENDANCE_OVERRIDES: Record<number, Attendance> = {
  4: "on_break", // Sam K.
  8: "not_clocked_in", // Dakota P.
};

export type Row = {
  id: number;
  name: string;
  start: number;
  end: number;
  type: ShiftType;
  attendance: Attendance;
};

export const ROSTER: Row[] = DEMO_EMPLOYEES.flatMap((e) => {
  const shift = EMPLOYEE_PATTERNS[e.id]?.[DAY_OF_WEEK];
  if (!shift) return [];
  const [start, end] = shift;
  const attendance: Attendance =
    start > NOW ? "upcoming" : ATTENDANCE_OVERRIDES[e.id] ?? "clocked_in";
  return [{
    id: e.id,
    name: formatDisplayName(e.name),
    start,
    end,
    type: getShiftType(start, end, OPEN, CLOSE) ?? "mid",
    attendance,
  }];
}).sort((a, b) => a.start - b.start);

export const OFF_TODAY = DEMO_EMPLOYEES.filter((e) => !EMPLOYEE_PATTERNS[e.id]?.[DAY_OF_WEEK]);
export const HERE = ROSTER.filter((r) => r.attendance === "clocked_in" || r.attendance === "on_break");
export const NOT_HERE = ROSTER.filter((r) => r.attendance === "not_clocked_in" || r.attendance === "upcoming");

// Coverage curve sampled every 30 minutes, like the app's timeline.
export const SAMPLES = Array.from({ length: (CLOSE - OPEN) / 30 + 1 }, (_, i) => OPEN + i * 30);
export const scheduledAt = (m: number) => ROSTER.filter((r) => m >= r.start && m < r.end).length;
export const clockedAt = (m: number) =>
  ROSTER.filter((r) => m >= r.start && m < r.end && r.attendance !== "not_clocked_in" && r.attendance !== "upcoming").length;

// Labor-hours budget per day (Sun–Sat) used for the planner preview; scheduled
// hours come straight from the demo fixtures.
export const BUDGET_HOURS = [56, 52, 56, 64, 64, 72, 80];
export const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Saturday's target staffing per hour, 6 AM – 10 PM.
export const TARGET_BY_HOUR = [2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 8, 7, 6, 5, 4, 3];
export function shortTime(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}
