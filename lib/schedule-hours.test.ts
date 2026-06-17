import { describe, it, expect } from "vitest";
import {
  WEEKLY_OVERTIME_THRESHOLD_MINUTES,
  shiftMinutes,
  scheduledMinutesByEmployee,
  summarizeWeeklyHours,
  wouldExceedThreshold,
  type EmployeeShift,
} from "./schedule-hours";

const WEEK = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];

// Helper: an 8-hour shift (480 min) on a given date for an employee.
function shift(employeeId: number, date: string, minutes = 480): EmployeeShift {
  return { employeeId, date, startMinutes: 480, endMinutes: 480 + minutes };
}

describe("shiftMinutes", () => {
  it("returns the duration in minutes", () => {
    expect(shiftMinutes({ startMinutes: 480, endMinutes: 960 })).toBe(480);
  });
});

describe("scheduledMinutesByEmployee", () => {
  it("sums minutes per employee within the week", () => {
    const shifts = [shift(1, "2026-07-06"), shift(1, "2026-07-07"), shift(2, "2026-07-06")];
    const map = scheduledMinutesByEmployee(shifts, WEEK);
    expect(map.get(1)).toBe(960);
    expect(map.get(2)).toBe(480);
  });

  it("ignores shifts outside the week window", () => {
    const shifts = [shift(1, "2026-07-06"), shift(1, "2026-07-20")];
    const map = scheduledMinutesByEmployee(shifts, WEEK);
    expect(map.get(1)).toBe(480);
  });

  it("normalizes timestamp-style dates to YYYY-MM-DD", () => {
    const shifts = [{ employeeId: 1, date: "2026-07-06T00:00:00Z", startMinutes: 480, endMinutes: 960 }];
    expect(scheduledMinutesByEmployee(shifts, WEEK).get(1)).toBe(480);
  });
});

describe("summarizeWeeklyHours", () => {
  it("flags an employee scheduled over 40 hours", () => {
    // 5 × 9h = 45h → 2700 min, 300 over threshold.
    const shifts = WEEK.slice(0, 5).map((d) => shift(1, d, 540));
    const [row] = summarizeWeeklyHours(shifts, WEEK);
    expect(row.employeeId).toBe(1);
    expect(row.totalMinutes).toBe(2700);
    expect(row.isOvertime).toBe(true);
    expect(row.overtimeMinutes).toBe(2700 - WEEKLY_OVERTIME_THRESHOLD_MINUTES);
  });

  it("does not flag an employee at exactly the threshold", () => {
    const shifts = WEEK.slice(0, 5).map((d) => shift(1, d, 480)); // 5 × 8h = 40h
    const [row] = summarizeWeeklyHours(shifts, WEEK);
    expect(row.totalMinutes).toBe(WEEKLY_OVERTIME_THRESHOLD_MINUTES);
    expect(row.isOvertime).toBe(false);
    expect(row.overtimeMinutes).toBe(0);
  });

  it("returns rows sorted by total minutes descending", () => {
    const shifts = [shift(1, "2026-07-06", 480), shift(2, "2026-07-06", 600), shift(2, "2026-07-07", 600)];
    const rows = summarizeWeeklyHours(shifts, WEEK);
    expect(rows.map((r) => r.employeeId)).toEqual([2, 1]);
  });

  it("honors a custom threshold", () => {
    const shifts = [shift(1, "2026-07-06", 480)]; // 8h
    const [row] = summarizeWeeklyHours(shifts, WEEK, 420); // 7h threshold
    expect(row.isOvertime).toBe(true);
    expect(row.overtimeMinutes).toBe(60);
  });
});

describe("wouldExceedThreshold", () => {
  it("is true when current + added crosses the threshold", () => {
    expect(wouldExceedThreshold(2160, 480)).toBe(true); // 36h + 8h = 44h
  });

  it("is false when the sum lands exactly on the threshold", () => {
    expect(wouldExceedThreshold(1920, 480)).toBe(false); // 32h + 8h = 40h
  });

  it("is false when well under", () => {
    expect(wouldExceedThreshold(600, 480)).toBe(false);
  });
});
