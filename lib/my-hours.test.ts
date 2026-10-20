import { describe, it, expect } from "vitest";
import { formatHours, myHoursRange, summarizeWeek, APPROACHING_OVERTIME_HOURS } from "./my-hours";
import type { PayrollWeek } from "./payroll";
import type { TimecardDay, Violation } from "./timecard";

function day(date: string, over: Partial<TimecardDay> = {}): TimecardDay {
  return {
    date,
    dayName: "Mon",
    schedule: null,
    schedules: [],
    punches: [],
    callout: null,
    workedHours: 8,
    breakHours: 0.5,
    breakCount: 1,
    hasIncomplete: false,
    violations: [],
    ...over,
  } as TimecardDay;
}

function week(weekStart: string, worked: number): PayrollWeek {
  return {
    weekStart,
    priorHours: 0,
    regularHours: Math.min(worked, 40),
    overtimeHours: Math.max(0, worked - 40),
    doubleTimeHours: 0,
    breakHours: 1,
    totalWorkedHours: worked,
    hasIncomplete: false,
    days: [],
  };
}

const v = (type: Violation["type"]): Violation => ({ type, label: type, detail: "" });

describe("myHoursRange", () => {
  it("covers last Monday–Sunday workweek and this one", () => {
    // Sunday Oct 18, 2026 is the last day of the week starting Monday Oct 12.
    expect(myHoursRange("2026-10-18")).toEqual({
      thisWeekStart: "2026-10-12",
      lastWeekStart: "2026-10-05",
      from: "2026-10-05",
      to: "2026-10-18",
    });
    expect(myHoursRange("2026-10-19").thisWeekStart).toBe("2026-10-19");
  });
});

describe("summarizeWeek", () => {
  it("takes the week's totals and overtime split from payroll", () => {
    const s = summarizeWeek([day("2026-10-12")], [week("2026-10-05", 20), week("2026-10-12", 42.5)], "2026-10-12", "2026-10-14");
    expect(s).toMatchObject({
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      workedHours: 42.5,
      regularHours: 40,
      overtimeHours: 2.5,
      hoursToOvertime: 0,
      approachingOvertime: false,
    });
  });

  it("is all zeros for a week with no hours", () => {
    const s = summarizeWeek([], [], "2026-10-12", "2026-10-14");
    expect(s).toMatchObject({ workedHours: 0, regularHours: 0, overtimeHours: 0, hoursToOvertime: 40, days: [] });
  });

  it("lists only the week's days up to today", () => {
    const days = [day("2026-10-09"), day("2026-10-12"), day("2026-10-14"), day("2026-10-16")];
    const s = summarizeWeek(days, [], "2026-10-12", "2026-10-14");
    expect(s.days.map((d) => d.date)).toEqual(["2026-10-12", "2026-10-14"]);
  });

  it(`warns from ${APPROACHING_OVERTIME_HOURS}h until overtime starts`, () => {
    expect(summarizeWeek([], [week("2026-10-12", 35.9)], "2026-10-12", "2026-10-14").approachingOvertime).toBe(false);
    const near = summarizeWeek([], [week("2026-10-12", 37.5)], "2026-10-12", "2026-10-14");
    expect(near).toMatchObject({ approachingOvertime: true, hoursToOvertime: 2.5 });
    expect(summarizeWeek([], [week("2026-10-12", 40)], "2026-10-12", "2026-10-14").approachingOvertime).toBe(false);
  });

  it("flags a day's missed punch, lateness and manual punches", () => {
    const days = [
      day("2026-10-12", {
        hasIncomplete: true,
        violations: [v("late_in"), v("long_break"), v("long_break")],
        punches: [{ id: 1, punchType: "clock_in", punchedAt: "", localMinutes: 0, isManual: true, note: null }],
      }),
      day("2026-10-13", { violations: [v("callout")], workedHours: 0 }),
    ];
    const s = summarizeWeek(days, [], "2026-10-12", "2026-10-14");
    expect(s.days[0].flags.map((f) => f.label)).toEqual(["Missing punch", "Late", "Long break", "Manual punch"]);
    expect(s.days[0].flags[0].tone).toBe("bad");
    expect(s.days[1].flags.map((f) => f.label)).toEqual(["Called out"]);
  });

  it("treats today's unpaired punches as a shift in progress", () => {
    const s = summarizeWeek([day("2026-10-14", { hasIncomplete: true })], [], "2026-10-12", "2026-10-14");
    expect(s.days[0].flags).toEqual([{ label: "In progress", tone: "info" }]);
    expect(s.shiftInProgress).toBe(true);
    expect(summarizeWeek([day("2026-10-14", { hasIncomplete: true })], [], "2026-10-05", "2026-10-14").shiftInProgress).toBe(false);
  });
});

describe("formatHours", () => {
  it("writes hours and minutes", () => {
    expect(formatHours(0)).toBe("0h");
    expect(formatHours(0.25)).toBe("15m");
    expect(formatHours(8)).toBe("8h");
    expect(formatHours(7.5)).toBe("7h 30m");
    expect(formatHours(41.99)).toBe("41h 59m");
    expect(formatHours(39.999)).toBe("40h");
  });
});

describe("myHoursRange — payroll workweek start", () => {
  it("uses the org's workweek start", () => {
    // Sunday workweek: Sun Oct 18 starts a new week.
    expect(myHoursRange("2026-10-18", 0)).toEqual({
      thisWeekStart: "2026-10-18", lastWeekStart: "2026-10-11", from: "2026-10-11", to: "2026-10-24",
    });
    expect(myHoursRange("2026-10-17", 6).thisWeekStart).toBe("2026-10-17");
  });
});

describe("summarizeWeek — pay rules", () => {
  it("passes double time through", () => {
    const w = { ...week("2026-10-12", 50), regularHours: 40, overtimeHours: 8, doubleTimeHours: 2 };
    expect(summarizeWeek([], [w], "2026-10-12", "2026-10-14")).toMatchObject({ overtimeHours: 8, doubleTimeHours: 2 });
  });

  it("never counts down to overtime for an exempt employee", () => {
    const w = { ...week("2026-10-12", 38), regularHours: 38, overtimeHours: 0 };
    const s = summarizeWeek([], [w], "2026-10-12", "2026-10-14", true);
    expect(s.hoursToOvertime).toBe(0);
    expect(s.approachingOvertime).toBe(false);
    expect(summarizeWeek([], [w], "2026-10-12", "2026-10-14").approachingOvertime).toBe(true);
  });
});
