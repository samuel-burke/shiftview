// Regression tests for configurable pay rules (lib/pay-rules.ts) as payroll
// applies them: daily overtime and double time by state, California's 7th-day
// rule, exempt employees, the workweek start day, shifts across the workweek
// boundary and across midnight, DST, and punch rounding.
//
// Runs under TZ=UTC, Pacific/Kiritimati and America/St_Johns in CI: every
// instant here is built in the store's zone with zonedTimeToUtc.

import { describe, it, expect } from "vitest";
import { computePayroll, payrollQueryWindow, type EmployeePayroll, type PunchRow } from "./payroll";
import { addDaysToKey, zonedTimeToUtc } from "./dates";
import type { PayRules } from "./pay-rules";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

let nextId = 1;
function row(employee_id: number, punch_type: string, ms: number, name = `Emp ${employee_id}`): PunchRow {
  return { id: nextId++, employee_id, punch_type, punched_at: new Date(ms).toISOString(), employees: { name } };
}

const at = (date: string, minutes: number, tz: string) => zonedTimeToUtc(date, minutes, tz).getTime();

// One shift: clock in on `date` at `startMin` (store time), worked for
// `lengthMin` real minutes (so it may cross midnight or a DST change).
function shift(date: string, startMin: number, lengthMin: number, tz: string, emp = 1): PunchRow[] {
  const start = at(date, startMin, tz);
  return [row(emp, "clock_in", start), row(emp, "clock_out", start + lengthMin * 60_000)];
}

// Shifts of `hours` starting 8 AM on each date.
function days(dates: string[], hours: number, tz: string, emp = 1): PunchRow[] {
  return dates.flatMap((d) => shift(d, 8 * 60, hours * 60, tz, emp));
}

function run(rows: PunchRow[], tz: string, rules: Partial<PayRules>, range?: { from: string; to: string }, exempt: number[] = []) {
  const all = range ? queried(rows, range.from, range.to, tz, rules.workweekStartDay ?? 1) : rows;
  return computePayroll(all, tz, range, { rules, exemptEmployeeIds: new Set(exempt) });
}

function queried(all: PunchRow[], from: string, to: string, tz: string, weekStart: number): PunchRow[] {
  const { start, end } = payrollQueryWindow(from, to, tz, weekStart);
  return all.filter((p) => p.punched_at >= start && p.punched_at <= end);
}

const split = (e: EmployeePayroll) => [e.totalRegularHours, e.totalOvertimeHours, e.totalDoubleTimeHours];
const daySplits = (e: EmployeePayroll) =>
  e.weeks.flatMap((w) => w.days.map((d) => [d.date, d.regularHours, d.overtimeHours, d.doubleTimeHours]));

// Mon Jun 8 – Sun Jun 14 2026.
const WEEK = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];

describe("federal rule (default)", () => {
  it("is what payroll does with no options", () => {
    const rows = days(WEEK.slice(0, 5), 10, NY);
    expect(computePayroll(rows, NY)).toEqual(run(rows, NY, { overtimeRule: "federal", workweekStartDay: 1, roundingMinutes: 0 }));
  });

  it("pays exactly 40h as regular", () => {
    const [e] = run(days(WEEK.slice(0, 5), 8, NY), NY, {});
    expect(split(e)).toEqual([40, 0, 0]);
  });

  it("makes the first minute past 40h overtime", () => {
    const rows = [...days(WEEK.slice(0, 4), 8, NY), ...shift(WEEK[4], 480, 8 * 60 + 1, NY)];
    const [e] = run(rows, NY, {});
    expect(e.totalRegularHours).toBe(40);
    expect(e.totalOvertimeHours).toBe(0.02);
  });

  it("has no daily overtime or double time", () => {
    const [e] = run(shift(WEEK[0], 360, 14 * 60, NY), NY, {});
    expect(split(e)).toEqual([14, 0, 0]);
  });

  it("keeps a shift past midnight whole on its start day inside a workweek", () => {
    const [e] = run(shift(WEEK[1], 18 * 60, 10 * 60, NY), NY, {}); // Tue 6 PM → Wed 4 AM
    expect(daySplits(e)).toEqual([["2026-06-09", 10, 0, 0]]);
  });
});

describe("california", () => {
  const CA: Partial<PayRules> = { overtimeRule: "california" };

  it("pays exactly 8h in a day as regular", () => {
    expect(split(run(shift(WEEK[0], 480, 480, LA), LA, CA)[0])).toEqual([8, 0, 0]);
  });

  it("makes hours past 8 in a day overtime", () => {
    expect(split(run(shift(WEEK[0], 480, 8 * 60 + 30, LA), LA, CA)[0])).toEqual([8, 0.5, 0]);
  });

  it("pays exactly 12h as 8 regular and 4 overtime", () => {
    expect(split(run(shift(WEEK[0], 480, 720, LA), LA, CA)[0])).toEqual([8, 4, 0]);
  });

  it("makes hours past 12 in a day double time", () => {
    expect(split(run(shift(WEEK[0], 360, 13 * 60 + 15, LA), LA, CA)[0])).toEqual([8, 4, 1.25]);
  });

  it("doesn't count daily overtime again toward the weekly 40", () => {
    // 5 × 9h = 45h: 1h daily OT each day, 40 regular, no weekly OT on top.
    expect(split(run(days(WEEK.slice(0, 5), 9, LA), LA, CA)[0])).toEqual([40, 5, 0]);
  });

  it("makes regular hours past 40 in the week overtime", () => {
    // 6 × 8h = 48h, Mon–Sat: Saturday is weekly overtime.
    const [e] = run(days(WEEK.slice(0, 6), 8, LA), LA, CA);
    expect(split(e)).toEqual([40, 8, 0]);
    expect(daySplits(e).at(-1)).toEqual(["2026-06-13", 0, 8, 0]);
  });

  it("splits the day that crosses 40 regular hours", () => {
    // 6 × 7h = 42h: the 6th day is 5 regular + 2 weekly overtime.
    const [e] = run(days(WEEK.slice(0, 6), 7, LA), LA, CA);
    expect(daySplits(e).at(-1)).toEqual(["2026-06-13", 5, 2, 0]);
    expect(split(e)).toEqual([40, 2, 0]);
  });

  it("applies daily and weekly rules together without double counting", () => {
    // 4 × 10h + 1 × 10h: 8 regular + 2 OT a day, 40 regular in all.
    expect(split(run(days(WEEK.slice(0, 5), 10, LA), LA, CA)[0])).toEqual([40, 10, 0]);
    // 5 × 10h + Sat 6h: Saturday's 6h are past 40 regular → weekly OT.
    const [e] = run([...days(WEEK.slice(0, 5), 10, LA), ...shift(WEEK[5], 480, 360, LA)], LA, CA);
    expect(split(e)).toEqual([40, 16, 0]);
  });

  describe("7th consecutive workday", () => {
    it("pays the 7th day's first 8h as overtime", () => {
      const [e] = run(days(WEEK, 6, LA), LA, CA);
      const sunday = e.weeks[0].days[6];
      expect(sunday.seventhConsecutiveDay).toBe(true);
      expect([sunday.regularHours, sunday.overtimeHours, sunday.doubleTimeHours]).toEqual([0, 6, 0]);
      expect(split(e)).toEqual([36, 6, 0]);
    });

    it("pays exactly 8h on the 7th day as overtime, with no double time", () => {
      const [e] = run([...days(WEEK.slice(0, 6), 4, LA), ...shift(WEEK[6], 480, 480, LA)], LA, CA);
      expect(daySplits(e).at(-1)).toEqual(["2026-06-14", 0, 8, 0]);
    });

    it("pays the 7th day's hours past 8 as double time", () => {
      const [e] = run([...days(WEEK.slice(0, 6), 4, LA), ...shift(WEEK[6], 480, 10 * 60, LA)], LA, CA);
      expect(daySplits(e).at(-1)).toEqual(["2026-06-14", 0, 8, 2]);
    });

    it("doesn't apply when a day of the workweek was off", () => {
      const worked = WEEK.filter((d) => d !== "2026-06-10");
      const [e] = run(days(worked, 6, LA), LA, CA);
      expect(e.weeks[0].days.some((d) => d.seventhConsecutiveDay)).toBe(false);
      expect(split(e)).toEqual([36, 0, 0]);
    });

    it("is the last day of the store's workweek, not always Sunday", () => {
      // Workweek Sun Jun 7 – Sat Jun 13: Saturday is the 7th day.
      const dates = ["2026-06-07", ...WEEK.slice(0, 6)];
      const [e] = run(days(dates, 6, LA), LA, { ...CA, workweekStartDay: 0 });
      expect(e.weeks).toHaveLength(1);
      expect(e.weeks[0].weekStart).toBe("2026-06-07");
      expect(e.weeks[0].days.at(-1)).toMatchObject({ date: "2026-06-13", seventhConsecutiveDay: true, overtimeHours: 6 });
      // With a Monday workweek the same days are two partial weeks: no 7th day.
      const [mon] = run(days(dates, 6, LA), LA, CA);
      expect(mon.weeks.flatMap((w) => w.days).some((d) => d.seventhConsecutiveDay)).toBe(false);
    });

    it("counts days worked before the report's range", () => {
      const [e] = run(days(WEEK, 6, LA), LA, CA, { from: "2026-06-12", to: "2026-06-18" });
      expect(e.weeks[0].priorHours).toBe(24);
      expect(daySplits(e)).toEqual([
        ["2026-06-12", 6, 0, 0], ["2026-06-13", 6, 0, 0], ["2026-06-14", 0, 6, 0],
      ]);
    });

    it("isn't triggered by a day with only an unpaired punch", () => {
      const rows = [...days(WEEK.slice(0, 2), 6, LA), row(1, "clock_out", at(WEEK[2], 600, LA)),
        ...days(WEEK.slice(3), 6, LA)];
      const [e] = run(rows, LA, CA);
      expect(e.weeks[0].days.some((d) => d.seventhConsecutiveDay)).toBe(false);
    });
  });

  describe("shifts across midnight are split at store midnight", () => {
    it("measures each calendar day against the daily limits", () => {
      // Mon 2 PM → Tue 2 AM (12h): 10h Monday (2 OT), 2h Tuesday. Kept whole
      // it would have been 8 regular + 4 overtime.
      const [e] = run(shift(WEEK[0], 14 * 60, 12 * 60, LA), LA, CA);
      expect(daySplits(e)).toEqual([["2026-06-08", 8, 2, 0], ["2026-06-09", 2, 0, 0]]);
    });

    it("adds the post-midnight hours to the next day's own shift", () => {
      // Mon 6 PM → Tue 2 AM (8h), then Tue 9 AM → 5 PM (8h): Tuesday is 10h.
      const rows = [...shift(WEEK[0], 18 * 60, 480, LA), ...shift(WEEK[1], 9 * 60, 480, LA)];
      const [e] = run(rows, LA, CA);
      expect(daySplits(e)).toEqual([["2026-06-08", 6, 0, 0], ["2026-06-09", 8, 2, 0]]);
    });

    it("splits a break that crosses midnight too", () => {
      const s = at(WEEK[0], 20 * 60, LA);
      const rows = [
        row(1, "clock_in", s), row(1, "break_start", s + 3.5 * 3_600_000),
        row(1, "break_end", s + 4.5 * 3_600_000), row(1, "clock_out", s + 6 * 3_600_000),
      ];
      const [e] = run(rows, LA, CA);
      expect(e.weeks[0].days.map((d) => [d.date, d.workedHours, d.breakHours])).toEqual([
        ["2026-06-08", 3.5, 0.5], ["2026-06-09", 1.5, 0.5],
      ]);
    });

    it("pays a midnight-split shift once when the range ends at midnight", () => {
      const rows = shift(WEEK[2], 20 * 60, 8 * 60, LA); // Wed 8 PM → Thu 4 AM
      const a = run(rows, LA, CA, { from: "2026-06-01", to: "2026-06-10" });
      const b = run(rows, LA, CA, { from: "2026-06-11", to: "2026-06-20" });
      expect(a[0].totalWorkedHours).toBe(4);
      expect(b[0].totalWorkedHours).toBe(4);
      expect(b[0].weeks[0].priorHours).toBe(4);
    });
  });

  describe("DST", () => {
    it("pays the 25-hour fall-back night by real hours, split at midnight", () => {
      // Sat Oct 31 8 PM → Sun Nov 1 6 AM (LA): 11 real hours; Saturday 4h,
      // Sunday 7h (midnight to 6 AM with the repeated hour).
      const start = at("2026-10-31", 20 * 60, LA);
      const end = at("2026-11-01", 6 * 60, LA);
      expect((end - start) / 3_600_000).toBe(11);
      const [e] = run([row(1, "clock_in", start), row(1, "clock_out", end)], LA, CA);
      expect(daySplits(e)).toEqual([["2026-10-31", 4, 0, 0], ["2026-11-01", 7, 0, 0]]);
    });

    it("pays the spring-forward night by real hours, split at midnight", () => {
      const start = at("2026-03-07", 20 * 60, LA);
      const end = at("2026-03-08", 6 * 60, LA);
      const [e] = run([row(1, "clock_in", start), row(1, "clock_out", end)], LA, CA);
      expect(daySplits(e)).toEqual([["2026-03-07", 4, 0, 0], ["2026-03-08", 5, 0, 0]]);
    });

    it("makes the fall-back day's extra hour daily overtime", () => {
      // Midnight → 8 AM on the wall clock is 9 real hours.
      const rows = [row(1, "clock_in", at("2026-11-01", 0, LA)), row(1, "clock_out", at("2026-11-01", 480, LA))];
      expect(split(run(rows, LA, CA)[0])).toEqual([8, 1, 0]);
    });
  });
});

describe("alaska", () => {
  const AK: Partial<PayRules> = { overtimeRule: "alaska" };
  it("pays past 8h a day as overtime, never double time", () => {
    expect(split(run(shift(WEEK[0], 480, 480, "America/Anchorage"), "America/Anchorage", AK)[0])).toEqual([8, 0, 0]);
    expect(split(run(shift(WEEK[0], 360, 13 * 60, "America/Anchorage"), "America/Anchorage", AK)[0])).toEqual([8, 5, 0]);
  });
  it("applies the weekly 40 to regular hours", () => {
    expect(split(run(days(WEEK.slice(0, 6), 8, "America/Anchorage"), "America/Anchorage", AK)[0])).toEqual([40, 8, 0]);
  });
});

describe("nevada", () => {
  const NV = "America/Los_Angeles";
  it("is weekly-only unless daily overtime is turned on", () => {
    expect(split(run(shift(WEEK[0], 480, 600, NV), NV, { overtimeRule: "nevada" })[0])).toEqual([10, 0, 0]);
    expect(split(run(days(WEEK.slice(0, 5), 10, NV), NV, { overtimeRule: "nevada" })[0])).toEqual([40, 10, 0]);
  });
  it("pays past 8h a day as overtime with the daily flag", () => {
    const rules: Partial<PayRules> = { overtimeRule: "nevada", nevadaDailyOvertime: true };
    expect(split(run(shift(WEEK[0], 480, 480, NV), NV, rules)[0])).toEqual([8, 0, 0]);
    expect(split(run(shift(WEEK[0], 480, 600, NV), NV, rules)[0])).toEqual([8, 2, 0]);
    expect(split(run(shift(WEEK[0], 360, 14 * 60, NV), NV, rules)[0])).toEqual([8, 6, 0]);
  });
  it("ignores the daily flag under other rules", () => {
    expect(split(run(shift(WEEK[0], 480, 600, NV), NV, { nevadaDailyOvertime: true })[0])).toEqual([10, 0, 0]);
  });
});

describe("colorado", () => {
  const CO: Partial<PayRules> = { overtimeRule: "colorado" };
  const DEN = "America/Denver";
  it("pays exactly 12h in a day as regular", () => {
    expect(split(run(shift(WEEK[0], 360, 720, DEN), DEN, CO)[0])).toEqual([12, 0, 0]);
  });
  it("pays past 12h a day as overtime, never double time", () => {
    expect(split(run(shift(WEEK[0], 360, 14 * 60, DEN), DEN, CO)[0])).toEqual([12, 2, 0]);
  });
  it("applies the weekly 40", () => {
    expect(split(run(days(WEEK.slice(0, 5), 10, DEN), DEN, CO)[0])).toEqual([40, 10, 0]);
  });
});

describe("exempt employees", () => {
  it("get every hour as regular and are marked exempt", () => {
    const rows = [...days(WEEK.slice(0, 5), 10, NY, 1), ...days(WEEK.slice(0, 5), 10, NY, 2)];
    const [a, b] = run(rows, NY, {}, undefined, [1]);
    expect(a.employeeId).toBe(1);
    expect(a.exempt).toBe(true);
    expect(split(a)).toEqual([50, 0, 0]);
    // Their coworker in the same report still gets overtime.
    expect(b.exempt).toBe(false);
    expect(split(b)).toEqual([40, 10, 0]);
  });

  it("get no daily overtime, double time or 7th-day premium under California", () => {
    const [e] = run([...days(WEEK.slice(0, 6), 6, LA), ...shift(WEEK[6], 360, 14 * 60, LA)], LA,
      { overtimeRule: "california" }, undefined, [1]);
    expect(split(e)).toEqual([50, 0, 0]);
    expect(e.weeks[0].days.some((d) => d.seventhConsecutiveDay)).toBe(false);
  });
});

describe("workweek start day", () => {
  it("groups days into weeks starting on the chosen day", () => {
    // Sun Jun 7 – Sat Jun 13, 10h each day.
    const dates = ["2026-06-07", ...WEEK.slice(0, 6)];
    const sun = run(days(dates, 10, NY), NY, { workweekStartDay: 0 })[0];
    expect(sun.weeks.map((w) => [w.weekStart, w.totalWorkedHours, w.overtimeHours])).toEqual([["2026-06-07", 70, 30]]);
    const mon = run(days(dates, 10, NY), NY, {})[0];
    expect(mon.weeks.map((w) => [w.weekStart, w.totalWorkedHours, w.overtimeHours])).toEqual([
      ["2026-06-01", 10, 0], ["2026-06-08", 60, 20],
    ]);
  });

  it("reads from the day before the chosen workweek starts", () => {
    // Wed Jun 10: Saturday-start week begins Sat Jun 6; pad to Fri Jun 5.
    expect(payrollQueryWindow("2026-06-10", "2026-06-12", NY, 6).start).toBe("2026-06-05T04:00:00.000Z");
    expect(payrollQueryWindow("2026-06-10", "2026-06-12", NY).start).toBe("2026-06-07T04:00:00.000Z");
  });

  it("counts earlier days of a chosen workweek toward overtime in a mid-week range", () => {
    // Sunday-start week Jun 7–13, 10h Sun–Thu; range from Wed.
    const rows = days(["2026-06-07", ...WEEK.slice(0, 4)], 10, NY);
    const [e] = run(rows, NY, { workweekStartDay: 0 }, { from: "2026-06-10", to: "2026-06-16" });
    expect(e.weeks[0].priorHours).toBe(30);
    expect(daySplits(e)).toEqual([["2026-06-10", 10, 0, 0], ["2026-06-11", 0, 10, 0]]);
  });
});

describe("shift across the workweek start (hours count in the week worked)", () => {
  it("splits a Sunday-night shift at Monday's midnight under the federal rule", () => {
    // 40h Mon–Fri, then Sun 8 PM → Mon 4 AM.
    const rows = [...days(WEEK.slice(0, 5), 8, NY), ...shift("2026-06-14", 20 * 60, 8 * 60, NY)];
    const [e] = run(rows, NY, {});
    expect(e.weeks.map((w) => [w.weekStart, w.regularHours, w.overtimeHours])).toEqual([
      ["2026-06-08", 40, 4], // the 4h before midnight are this week's overtime
      ["2026-06-15", 4, 0],  // the 4h after are next week's regular time
    ]);
    expect(e.weeks[1].days.map((d) => [d.date, d.workedHours])).toEqual([["2026-06-15", 4]]);
  });

  it("splits at the chosen workweek start, not at Monday", () => {
    // Saturday 8 PM → Sunday 4 AM with a Sunday workweek.
    const [e] = run(shift("2026-06-13", 20 * 60, 8 * 60, NY), NY, { workweekStartDay: 0 });
    expect(e.weeks.map((w) => [w.weekStart, w.totalWorkedHours])).toEqual([["2026-06-07", 4], ["2026-06-14", 4]]);
  });

  it("splits by real hours when the workweek starts on the fall-back night", () => {
    // Sunday workweek; Sat Oct 31 10 PM → Sun Nov 1 6 AM (NY) is 9 real
    // hours: 2 before midnight, 7 after (the repeated hour included).
    const start = at("2026-10-31", 22 * 60, NY);
    const end = at("2026-11-01", 6 * 60, NY);
    const [e] = run([row(1, "clock_in", start), row(1, "clock_out", end)], NY, { workweekStartDay: 0 });
    expect(e.weeks.map((w) => [w.weekStart, w.totalWorkedHours])).toEqual([["2026-10-25", 2], ["2026-11-01", 7]]);
  });

  it("splits by real hours when the workweek starts on the spring-forward night", () => {
    const start = at("2026-03-07", 22 * 60, NY);
    const end = at("2026-03-08", 6 * 60, NY);
    const [e] = run([row(1, "clock_in", start), row(1, "clock_out", end)], NY, { workweekStartDay: 0 });
    expect(e.weeks.map((w) => [w.weekStart, w.totalWorkedHours])).toEqual([["2026-03-01", 2], ["2026-03-08", 5]]);
  });

  it("pays each part once across consecutive weekly reports", () => {
    const rows = shift("2026-06-14", 20 * 60, 8 * 60, NY);
    const a = run(rows, NY, {}, { from: "2026-06-08", to: "2026-06-14" });
    const b = run(rows, NY, {}, { from: "2026-06-15", to: "2026-06-21" });
    expect(a[0].totalWorkedHours + b[0].totalWorkedHours).toBe(8);
    expect(a[0].totalWorkedHours).toBe(4);
  });

  it("flags an unpaired shift on the days it touched", () => {
    const s = at("2026-06-14", 20 * 60, NY);
    const rows = [row(1, "clock_in", s), row(1, "clock_in", s + 3_600_000), row(1, "clock_out", s + 8 * 3_600_000)];
    const [e] = run(rows, NY, {});
    expect(e.weeks.map((w) => w.hasIncomplete)).toEqual([true, true]);
  });
});

describe("punch rounding", () => {
  const m = (date: string, h: number, min: number, sec = 0) => at(date, h * 60 + min, NY) + sec * 1000;

  it("rounds clock-in and clock-out the same way (nearest 15)", () => {
    const up = [row(1, "clock_in", m(WEEK[0], 9, 7)), row(1, "clock_out", m(WEEK[0], 17, 8))];
    expect(run(up, NY, { roundingMinutes: 15 })[0].totalWorkedHours).toBe(8.25); // 9:00 → 17:15
    const down = [row(1, "clock_in", m(WEEK[0], 9, 8)), row(1, "clock_out", m(WEEK[0], 17, 7))];
    expect(run(down, NY, { roundingMinutes: 15 })[0].totalWorkedHours).toBe(7.75); // 9:15 → 17:00
  });

  it("leaves punches exact when off", () => {
    const rows = [row(1, "clock_in", m(WEEK[0], 9, 7)), row(1, "clock_out", m(WEEK[0], 17, 8))];
    expect(run(rows, NY, {})[0].totalWorkedHours).toBe(8.02);
  });

  it("doesn't round breaks", () => {
    const d = WEEK[0];
    const rows = [
      row(1, "clock_in", m(d, 9, 0)), row(1, "break_start", m(d, 12, 7)),
      row(1, "break_end", m(d, 12, 38)), row(1, "clock_out", m(d, 17, 0)),
    ];
    const [e] = run(rows, NY, { roundingMinutes: 15 });
    expect(e.totalBreakHours).toBe(0.52);
  });

  it("never rounds a clock-in past the break that follows it", () => {
    const d = WEEK[0];
    const rows = [
      row(1, "clock_in", m(d, 9, 8)), row(1, "break_start", m(d, 9, 10)),
      row(1, "break_end", m(d, 9, 40)), row(1, "clock_out", m(d, 17, 0)),
    ];
    const [e] = run(rows, NY, { roundingMinutes: 15 });
    expect(e.weeks[0].days[0].workedHours).toBe(7.33); // 9:40 → 17:00
    expect(e.weeks[0].hasIncomplete).toBe(false);
  });

  it("moves hours over a daily threshold the way the rounded times say", () => {
    // 8:00 → 16:08 is 8h 8m exact (overtime under California), 8h 15m rounded to 15.
    const rows = [row(1, "clock_in", at(WEEK[0], 480, LA)), row(1, "clock_out", at(WEEK[0], 968, LA))];
    expect(split(run(rows, LA, { overtimeRule: "california", roundingMinutes: 15 })[0])).toEqual([8, 0.25, 0]);
    const rows2 = [row(1, "clock_in", at(WEEK[0], 480, LA)), row(1, "clock_out", at(WEEK[0], 967, LA))];
    expect(split(run(rows2, LA, { overtimeRule: "california", roundingMinutes: 15 })[0])).toEqual([8, 0, 0]);
  });

  it("uses each punch's real time to pick its work day", () => {
    // Clock-in 11:53 PM Monday rounds to midnight; the shift still starts Monday's bucket.
    const rows = [row(1, "clock_in", at(WEEK[0], 23 * 60 + 53, NY)), row(1, "clock_out", at(WEEK[1], 8 * 60 + 7, NY))];
    expect(run(rows, NY, { roundingMinutes: 15 })[0].weeks[0].days.map((d) => [d.date, d.workedHours]))
      .toEqual([["2026-06-08", 8]]);
    // Under a daily rule the rounded hours all fall on Tuesday.
    expect(run(rows, NY, { roundingMinutes: 15, overtimeRule: "california" })[0].weeks[0].days
      .map((d) => [d.date, d.workedHours])).toEqual([["2026-06-08", 0], ["2026-06-09", 8]]);
  });
});

// ── Properties over random schedules, for every rule ────────────────────────

function prng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

function randomPunches(rand: () => number, tz: string, firstDay: string, n: number): PunchRow[] {
  const rows: PunchRow[] = [];
  let lastEnd = 0;
  for (let i = 0; i < n; i++) {
    if (rand() < 0.15) continue;
    const date = addDaysToKey(firstDay, i);
    const startMin = Math.floor(rand() * 22 * 60);
    const lengthMin = 3 * 60 + Math.floor(rand() * 12 * 60); // 3–15h: past 8 and 12, across midnight
    const start = zonedTimeToUtc(date, startMin, tz).getTime() + Math.floor(rand() * 59) * 1000;
    if (start < lastEnd + 3_600_000) continue;
    const end = start + lengthMin * 60_000 + Math.floor(rand() * 59) * 1000;
    lastEnd = end;
    rows.push(row(1, "clock_in", start));
    if (rand() < 0.5) {
      const b = start + Math.floor(lengthMin / 2) * 60_000;
      rows.push(row(1, "break_start", b), row(1, "break_end", b + 30 * 60_000));
    }
    rows.push(row(1, "clock_out", end));
  }
  return rows;
}

describe("pay rules — properties", () => {
  const rulesList: Partial<PayRules>[] = [
    {},
    { overtimeRule: "california" },
    { overtimeRule: "california", workweekStartDay: 0, roundingMinutes: 15 },
    { overtimeRule: "alaska", workweekStartDay: 3, roundingMinutes: 6 },
    { overtimeRule: "nevada", nevadaDailyOvertime: true, roundingMinutes: 5 },
    { overtimeRule: "colorado", workweekStartDay: 6 },
    { workweekStartDay: 0 },
  ];
  const zones: [string, string][] = [
    [LA, "2026-02-23"], // spring forward
    [NY, "2026-10-12"], // fall back
    ["Australia/Sydney", "2026-03-23"],
    ["Asia/Kathmandu", "2026-06-01"],
  ];

  for (const rules of rulesList) {
    it.each(zones)(`${JSON.stringify(rules)} in %s from %s: any split pays the same hours`, (tz, firstDay) => {
      const rand = prng(firstDay.length * 31 + tz.length + JSON.stringify(rules).length);
      const all = randomPunches(rand, tz, firstDay, 35);
      const lastDay = addDaysToKey(firstDay, 34);
      const sum = (r: EmployeePayroll[], f: (e: EmployeePayroll) => number) => r.reduce((s, e) => s + f(e), 0);
      const whole = run(all, tz, rules, { from: firstDay, to: lastDay });
      for (const e of whole) {
        expect(Math.round((e.totalRegularHours + e.totalOvertimeHours + e.totalDoubleTimeHours) * 100) / 100)
          .toBe(e.totalWorkedHours);
        for (const w of e.weeks) {
          expect(w.regularHours).toBeLessThanOrEqual(40);
          for (const d of w.days) {
            expect(d.regularHours).toBeGreaterThanOrEqual(0);
            expect(d.overtimeHours).toBeGreaterThanOrEqual(0);
            expect(d.doubleTimeHours).toBeGreaterThanOrEqual(0);
            if (rules.overtimeRule === "california" && !d.seventhConsecutiveDay) expect(d.regularHours).toBeLessThanOrEqual(8);
            if (rules.overtimeRule !== "california") expect(d.doubleTimeHours).toBe(0);
          }
        }
      }
      for (let k = 0; k < 8; k++) {
        const cut = addDaysToKey(firstDay, 1 + Math.floor(rand() * 33));
        const a = run(all, tz, rules, { from: firstDay, to: addDaysToKey(cut, -1) });
        const b = run(all, tz, rules, { from: cut, to: lastDay });
        for (const f of [
          (e: EmployeePayroll) => e.totalWorkedHours,
          (e: EmployeePayroll) => e.totalOvertimeHours,
          (e: EmployeePayroll) => e.totalDoubleTimeHours,
        ]) {
          expect(Math.abs(sum(a, f) + sum(b, f) - sum(whole, f))).toBeLessThanOrEqual(0.02);
        }
      }
    });
  }

  it("returns nothing for no punches", () => {
    expect(computePayroll([], LA, { from: "2026-06-01", to: "2026-06-07" }, { rules: { overtimeRule: "california" } })).toEqual([]);
  });
});
