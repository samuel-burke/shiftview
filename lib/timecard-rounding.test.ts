// The time card with punch rounding on: it shows both the real punch time and
// the rounded time payroll pays, and judges lateness on the real time.

import { describe, it, expect } from "vitest";
import { computeTimecard, type TimecardPunchInput } from "./timecard";
import { DEFAULT_PUNCH_POLICY } from "./punch-policy";
import type { RoundingMinutes } from "./pay-rules";

const TZ = "America/New_York";
const DATE = "2026-01-15";
const est = (hh: number, mm: number, ss = 0) =>
  `${DATE}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}-05:00`;

let nextId = 1;
const punch = (punchType: TimecardPunchInput["punchType"], hh: number, mm: number, ss = 0): TimecardPunchInput =>
  ({ id: nextId++, punchType, punchedAt: est(hh, mm, ss) });

function build(punches: TimecardPunchInput[], roundingMinutes?: RoundingMinutes) {
  return computeTimecard({
    employeeId: 1, employeeName: "Test", from: DATE, to: DATE, timezone: TZ,
    policy: { ...DEFAULT_PUNCH_POLICY, lateInEnabled: true, lateInMinutes: 6 },
    schedules: [{ date: DATE, startMinutes: 540, endMinutes: 1020 }],
    punches, callouts: [], nowMs: Date.parse(est(23, 0)), roundingMinutes,
  });
}

describe("computeTimecard — punch rounding", () => {
  it("is off by default: no rounded times or hours", () => {
    const tc = build([punch("clock_in", 9, 7), punch("clock_out", 17, 8)]);
    expect(tc.roundingMinutes).toBe(0);
    expect(tc.totalRoundedWorkedHours).toBeNull();
    expect(tc.days[0].roundedWorkedHours).toBeNull();
    expect(tc.days[0].punches.every((p) => p.roundedAt === undefined)).toBe(true);
    expect(tc.days[0].workedHours).toBe(8.02);
  });

  it("shows the raw and the rounded time of each punch", () => {
    const tc = build([punch("clock_in", 9, 7), punch("clock_out", 17, 8)], 15);
    const [inP, outP] = tc.days[0].punches;
    expect(inP.punchedAt).toBe(est(9, 7)); // raw stays raw
    expect(inP.roundedAt).toBe(new Date(est(9, 0)).toISOString());
    expect(outP.roundedAt).toBe(new Date(est(17, 15)).toISOString());
    expect(tc.days[0].workedHours).toBe(8.02);
    expect(tc.days[0].roundedWorkedHours).toBe(8.25);
    expect(tc.totalRoundedWorkedHours).toBe(8.25);
  });

  it("rounds at the 7/8-minute edge", () => {
    const seven = build([punch("clock_in", 9, 7, 29), punch("clock_out", 17, 0)], 15);
    expect(seven.days[0].punches[0].roundedAt).toBe(new Date(est(9, 0)).toISOString());
    const eight = build([punch("clock_in", 9, 8), punch("clock_out", 17, 0)], 15);
    expect(eight.days[0].punches[0].roundedAt).toBe(new Date(est(9, 15)).toISOString());
    expect(eight.days[0].roundedWorkedHours).toBe(7.75);
  });

  it("leaves roundedAt null for a punch rounding doesn't move, and for breaks", () => {
    const tc = build([punch("clock_in", 9, 0), punch("break_start", 12, 7), punch("break_end", 12, 37), punch("clock_out", 17, 0)], 15);
    expect(tc.days[0].punches.map((p) => p.roundedAt)).toEqual([null, null, null, null]);
    expect(tc.days[0].roundedWorkedHours).toBe(7.5);
  });

  it("still judges lateness on the real punch time", () => {
    // 9:07 rounds to 9:00, but the employee was 7 minutes late.
    const tc = build([punch("clock_in", 9, 7), punch("clock_out", 17, 0)], 15);
    expect(tc.days[0].violations.map((v) => [v.type, v.minutes])).toEqual([["late_in", 7]]);
  });
});
