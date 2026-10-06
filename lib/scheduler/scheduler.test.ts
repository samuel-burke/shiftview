import { describe, it, expect } from "vitest";
import { generateSchedule } from "./index";
import { demoInput, employee, hardRuleViolations, input, WEEK } from "./__tests__/helpers";
import type { SchedulerInput } from "./types";
import type { CoverageBlock } from "@/lib/coverage";

// Curves for only some days of the week (the rest closed).
function onDays(days: Record<number, CoverageBlock[]>): Record<string, CoverageBlock[]> {
  return Object.fromEntries(Object.entries(days).map(([i, blocks]) => [WEEK[Number(i)], blocks]));
}

function run(inp: SchedulerInput) {
  const result = generateSchedule(inp);
  expect(hardRuleViolations(inp, result)).toEqual([]);
  return result;
}

const hoursOf = (result: ReturnType<typeof generateSchedule>, id: number) =>
  result.employees.find((e) => e.employeeId === id)!.minutes / 60;

describe("generateSchedule", () => {
  it("covers a simple day exactly, without overstaffing", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 2 }] }),
      employees: [employee(1), employee(2), employee(3)],
    }));
    expect(result.metrics.coverageScore).toBe(100);
    expect(result.metrics.scheduledHours).toBe(16);
    expect(result.metrics.overstaffHours).toBe(0);
    expect(result.gaps).toEqual([]);
    expect(result.shifts).toHaveLength(2);
  });

  it("schedules nobody on days without a coverage target, and says so", () => {
    const result = run(input({
      curves: onDays({ 1: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }] }),
      employees: [employee(1), employee(2)],
    }));
    expect(new Set(result.shifts.map((s) => s.date))).toEqual(new Set([WEEK[1]]));
    expect(result.warnings).toContainEqual({ code: "no_coverage_target", dates: WEEK.filter((_, i) => i !== 1) });
  });

  it("keeps within availability windows and off days", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1260, headcount: 1 }] }),
      employees: [
        employee(1, { availability: { 1: { startMinutes: 720, endMinutes: 1260 } } }), // Mondays from noon
        employee(2, { availability: { 1: { startMinutes: 540, endMinutes: 840 } } }),  // Mondays until 2 PM
      ],
    }));
    expect(result.metrics.coverageScore).toBe(100);
    const mine = (id: number) => result.shifts.filter((s) => s.employeeId === id);
    for (const s of mine(1)) expect(s.startMinutes).toBeGreaterThanOrEqual(720);
    for (const s of mine(2)) expect(s.endMinutes).toBeLessThanOrEqual(840);
  });

  it("never schedules approved time off, and avoids pending requests when it can", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }] }),
      employees: [
        employee(1, { unavailableDates: [WEEK[0]] }),
        employee(2, { pendingTimeOffDates: [WEEK[0]] }),
        employee(3),
      ],
    }));
    expect(result.shifts.map((s) => s.employeeId)).toEqual([3]);
  });

  it("uses someone with pending time off only when nobody else can, and flags it", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }] }),
      employees: [employee(2, { pendingTimeOffDates: [WEEK[0]] })],
    }));
    expect(result.shifts.map((s) => s.employeeId)).toEqual([2]);
    expect(result.employees[0].pendingTimeOffDates).toEqual([WEEK[0]]);
    expect(result.warnings).toContainEqual({ code: "pending_time_off_scheduled", employeeIds: [2] });
  });

  it("gives full-timers their minimum hours before cheaper part-timers", () => {
    const result = run(input({
      curves: Object.fromEntries(WEEK.map((d) => [d, [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }]])),
      employees: [
        employee(1, { employmentType: "full_time", payRate: 25 }),
        employee(2, { employmentType: "part_time", payRate: 12 }),
      ],
    }));
    expect(result.metrics.coverageScore).toBe(100);
    expect(hoursOf(result, 1)).toBeGreaterThanOrEqual(32);
    expect(hoursOf(result, 2)).toBeLessThanOrEqual(29);
    expect(result.employees.every((e) => !e.belowMinimum)).toBe(true);
  });

  it("goes over budget to reach full-timers' minimums, and warns", () => {
    // 56 h of coverage, but two full-timers with 32 h minimums.
    const result = run(input({
      curves: Object.fromEntries(WEEK.map((d) => [d, [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }]])),
      employees: [employee(1, { employmentType: "full_time" }), employee(2, { employmentType: "full_time" })],
    }));
    expect(hoursOf(result, 1)).toBeGreaterThanOrEqual(32);
    expect(hoursOf(result, 2)).toBeGreaterThanOrEqual(32);
    expect(result.warnings.find((w) => w.code === "over_budget")).toEqual({ code: "over_budget", hours: expect.any(Number) });
  });

  it("keeps everyone within their weekly maximum and explains the gap", () => {
    const result = run(input({
      curves: Object.fromEntries(WEEK.map((d) => [d, [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }]])),
      employees: [employee(1, { name: "Pat", employmentType: "part_time", maxWeeklyHours: 20 })],
    }));
    expect(hoursOf(result, 1)).toBe(20);
    expect(result.gaps.length).toBeGreaterThan(0);
    // Every gap, including the rest of a day they work part of, is down to their hours.
    expect(result.gaps.every((g) => g.reasons.length === 1 && g.reasons[0].code === "max_hours")).toBe(true);
    expect(result.suggestions).toEqual([{ kind: "raise_hours", employeeId: 1, maxHours: 28, overtime: false, gapMinutes: expect.any(Number) }]);
  });

  describe("overtime", () => {
    const sixDays = Object.fromEntries(WEEK.slice(0, 6).map((d) => [d, [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }]]));
    const soloFullTimer = employee(1, { employmentType: "full_time", maxDaysPerWeek: 6 });

    it("never goes past 40 hours by default, and suggests allowing it", () => {
      const result = run(input({ curves: sixDays, employees: [soloFullTimer] }));
      expect(hoursOf(result, 1)).toBe(40);
      expect(result.metrics.overtimeHours).toBe(0);
      expect(result.suggestions).toEqual([expect.objectContaining({ employeeId: 1, overtime: true, maxHours: 48 })]);
    });

    it("uses up to 8 hours of overtime to fill gaps when allowed", () => {
      const inp = input({ curves: sixDays, employees: [soloFullTimer] });
      inp.rules.overtimePolicy = "when_needed";
      const result = run(inp);
      expect(hoursOf(result, 1)).toBe(48);
      expect(result.metrics.overtimeHours).toBe(8);
      expect(result.metrics.coverageScore).toBe(100);
    });

    it("allows one person overtime with an hours adjustment", () => {
      const result = run(input({
        curves: sixDays,
        employees: [soloFullTimer],
        adjustments: [{ kind: "employee_hours", employeeId: 1, minHours: null, maxHours: 48 }],
      }));
      expect(hoursOf(result, 1)).toBe(48);
    });
  });

  it("leaves enough rest after last week's late shift", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 420, endMinutes: 900, headcount: 1 }] }),
      employees: [employee(1)],
      existing: [{ employeeId: 1, date: "2026-10-11", startMinutes: 840, endMinutes: 1380 }], // Sunday until 11 PM
    }));
    expect(result.shifts[0].startMinutes).toBeGreaterThanOrEqual(540); // 10 h after 11 PM
    expect(result.gaps[0]).toMatchObject({ date: WEEK[0], startMinutes: 420, endMinutes: 540 });
    expect(result.gaps[0].reasons).toEqual([{ code: "rest", employeeIds: [1] }]);
  });

  it("counts last week's days toward the consecutive-day limit", () => {
    const inp = input({
      curves: onDays({
        0: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }],
        1: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }],
      }),
      employees: [employee(1, { employmentType: "full_time" })],
      existing: [-5, -4, -3, -2, -1].map((d) => ({
        employeeId: 1,
        date: new Date(Date.UTC(2026, 9, 12 + d)).toISOString().slice(0, 10),
        startMinutes: 540,
        endMinutes: 1020,
      })),
    });
    inp.rules.maxConsecutiveDays = 6;
    const result = run(inp);
    expect(result.shifts.map((s) => s.date)).toEqual([WEEK[0]]);
    expect(result.gaps[0].reasons).toEqual([{ code: "consecutive_days", employeeIds: [1] }]);
  });

  it("works overnight when coverage runs through midnight", () => {
    const inp = input({
      curves: onDays({
        0: [{ startMinutes: 1200, endMinutes: 1440, headcount: 1 }],
        1: [{ startMinutes: 0, endMinutes: 240, headcount: 1 }],
      }),
      storeHours: {},
      employees: [employee(1)],
    });
    inp.rules.minShiftMinutes = 480;
    const result = run(inp);
    expect(result.shifts).toEqual([{ employeeId: 1, date: WEEK[0], startMinutes: 1200, endMinutes: 1680 }]);
    expect(result.metrics.coverageScore).toBe(100);
  });

  it("counts published shifts and drafts it fills around", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 2 }] }),
      employees: [employee(1), employee(2)],
      existing: [{ employeeId: 1, date: WEEK[0], startMinutes: 540, endMinutes: 1020 }],
    }));
    expect(result.metrics.coverageScoreBefore).toBe(0);
    expect(result.metrics.coverageScore).toBe(100);
    expect(result.shifts).toEqual([{ employeeId: 2, date: WEEK[0], startMinutes: 540, endMinutes: 1020 }]);
  });

  it("counts shifts of people no longer on the roster toward coverage", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }] }),
      employees: [employee(1)],
      existing: [{ employeeId: 99, date: WEEK[0], startMinutes: 540, endMinutes: 1020 }],
    }));
    expect(result.shifts).toEqual([]);
    expect(result.metrics.coverageScore).toBe(100);
  });

  it("honors shift-type and day preferences when it costs nothing", () => {
    const result = run(input({
      curves: onDays({
        0: [
          { startMinutes: 540, endMinutes: 780, headcount: 1 },
          { startMinutes: 1020, endMinutes: 1260, headcount: 1 },
        ],
      }),
      employees: [
        employee(1, { preferences: { shiftTypes: ["closer"], preferredDays: [], avoidDays: [], desiredWeeklyHours: null } }),
        employee(2, { preferences: { shiftTypes: ["opener"], preferredDays: [], avoidDays: [], desiredWeeklyHours: null } }),
      ],
    }));
    const byEmployee = Object.fromEntries(result.shifts.map((s) => [s.employeeId, s]));
    expect(byEmployee[2].startMinutes).toBe(540);
    expect(byEmployee[1].endMinutes).toBe(1260);
    expect(result.metrics.preferenceScore).toBe(100);
  });

  it("keeps people off days they'd rather not work when someone else can", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }] }),
      employees: [
        employee(1, { preferences: { shiftTypes: [], preferredDays: [], avoidDays: [1], desiredWeeklyHours: null } }),
        employee(2),
      ],
    }));
    expect(result.shifts.map((s) => s.employeeId)).toEqual([2]);
  });

  it("prefers the lower pay rate when all else is equal", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }] }),
      employees: [employee(1, { payRate: 30 }), employee(2, { payRate: 14 })],
    }));
    expect(result.shifts.map((s) => s.employeeId)).toEqual([2]);
  });

  it("applies coverage and keep-off adjustments", () => {
    const result = run(input({
      curves: onDays({ 0: [{ startMinutes: 540, endMinutes: 1020, headcount: 1 }] }),
      employees: [employee(1), employee(2), employee(3)],
      adjustments: [
        { kind: "coverage", date: WEEK[0], startMinutes: 540, endMinutes: 1020, delta: 1 },
        { kind: "employee_off", employeeId: 1, date: WEEK[0] },
      ],
    }));
    expect(result.shifts.map((s) => s.employeeId).sort()).toEqual([2, 3]);
    expect(result.metrics.budgetHours).toBe(16);
  });

  it("explains a gap nobody can work", () => {
    const result = run(input({
      curves: onDays({ 6: [{ startMinutes: 1080, endMinutes: 1260, headcount: 1 }] }), // Sunday evening
      employees: [
        employee(1, { availability: { 0: { startMinutes: null, endMinutes: null } } }),
        employee(2, { unavailableDates: [WEEK[6]] }),
      ],
    }));
    expect(result.shifts).toEqual([]);
    expect(result.gaps).toEqual([
      {
        date: WEEK[6],
        startMinutes: 1080,
        endMinutes: 1260,
        shortfall: 1,
        reasons: [
          { code: "unavailable", employeeIds: [1] },
          { code: "time_off", employeeIds: [2] },
        ],
      },
    ]);
    expect(result.metrics.coverageScore).toBe(0);
  });

  it("returns an empty schedule for an empty roster", () => {
    const result = run(input({ employees: [] }));
    expect(result.shifts).toEqual([]);
    expect(result.metrics.coverageScore).toBe(0);
    expect(result.gaps.length).toBe(7);
  });

  it("flags employees without an employment type", () => {
    const result = run(input({ employees: [employee(1, { employmentType: null }), employee(2)] }));
    expect(result.warnings).toContainEqual({ code: "employment_type_missing", employeeIds: [1] });
  });

  it("gives another valid version for another seed", () => {
    const a = run(demoInput(1));
    const b = run(demoInput(2));
    expect(b.shifts).not.toEqual(a.shifts);
    expect(b.metrics.coverageScore).toBe(100);
  });

  it("schedules the demo store well", () => {
    const result = run(demoInput(1));
    expect(result.metrics.coverageScore).toBe(100);
    expect(result.metrics.overtimeHours).toBe(0);
    // Within a couple of hours of the coverage budget, with every full-timer at their minimum.
    expect(Math.abs(result.metrics.scheduledHours - result.metrics.budgetHours)).toBeLessThanOrEqual(2);
    expect(result.employees.filter((e) => e.employmentType === "full_time" && e.typeSet).every((e) => !e.belowMinimum)).toBe(true);
  });
});
