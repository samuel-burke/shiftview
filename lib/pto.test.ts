import { describe, it, expect } from "vitest";
import {
  accrualPeriods,
  accrualWindow,
  computeAccrualEntries,
  DEFAULT_POLICY,
  defaultPaidHours,
  describePolicy,
  isValidPaidHours,
  paidLeaveByEmployeeDay,
  parsePolicies,
  parsePolicy,
  policyEnabled,
  validatePolicy,
  type AccrualPolicy,
} from "./pto";

const NY = "America/New_York";

function policy(p: Partial<AccrualPolicy>): AccrualPolicy {
  return { ...DEFAULT_POLICY, startsOn: "2026-01-01", ...p };
}

describe("defaultPaidHours", () => {
  it("is 8 with no schedule", () => {
    expect(defaultPaidHours([], "2026-05-04", NY)).toBe(8);
  });
  it("is the scheduled hours that day", () => {
    expect(defaultPaidHours([{ startMinutes: 540, endMinutes: 990 }], "2026-05-04", NY)).toBe(7.5);
  });
  it("adds split shifts", () => {
    expect(defaultPaidHours([{ startMinutes: 480, endMinutes: 720 }, { startMinutes: 1020, endMinutes: 1260 }], "2026-05-04", NY)).toBe(8);
  });
  it("counts an overnight shift whole", () => {
    expect(defaultPaidHours([{ startMinutes: 1320, endMinutes: 1800 }], "2026-05-04", NY)).toBe(8);
  });
  it("counts the hour lost on a spring-forward night", () => {
    // Midnight–8 AM on 2026-03-08 in New York is 7 real hours.
    expect(defaultPaidHours([{ startMinutes: 0, endMinutes: 480 }], "2026-03-08", NY)).toBe(7);
  });
  it("counts the hour gained on a fall-back night", () => {
    expect(defaultPaidHours([{ startMinutes: 0, endMinutes: 480 }], "2026-11-01", NY)).toBe(9);
  });
  it("never exceeds 24", () => {
    expect(defaultPaidHours([{ startMinutes: 0, endMinutes: 1440 }, { startMinutes: 0, endMinutes: 600 }], "2026-05-04", NY)).toBe(24);
  });
  it("ignores an inverted shift", () => {
    expect(defaultPaidHours([{ startMinutes: 600, endMinutes: 540 }], "2026-05-04", NY)).toBe(8);
  });
});

describe("isValidPaidHours", () => {
  it.each([[8, true], [0.25, true], [24, true], [0, false], [-1, false], [24.01, false], [7.555, false], [NaN, false], ["8", false]])(
    "%s → %s", (v, ok) => expect(isValidPaidHours(v)).toBe(ok));
});

describe("policies", () => {
  it("defaults to no accrual", () => {
    expect(parsePolicy(undefined)).toEqual(DEFAULT_POLICY);
    expect(parsePolicy("not json")).toEqual(DEFAULT_POLICY);
    expect(parsePolicy(JSON.stringify({ method: "bogus" }))).toEqual(DEFAULT_POLICY);
    expect(policyEnabled(DEFAULT_POLICY)).toBe(false);
    const both = parsePolicies({});
    expect(both.pto.method).toBe("none");
    expect(both.sick.method).toBe("none");
  });

  it("round-trips a stored policy", () => {
    const p = policy({ method: "per_hours_worked", annualCap: 40, carryoverCap: 24 });
    expect(parsePolicy(JSON.stringify(p))).toEqual(p);
  });

  it("starts accrual on the day a policy is turned on", () => {
    const r = validatePolicy({ method: "per_hours_worked" }, DEFAULT_POLICY, "2026-10-18");
    expect(r.policy?.startsOn).toBe("2026-10-18");
  });

  it("restarts on a rate change but not on a cap change", () => {
    const current = policy({ method: "per_hours_worked", startsOn: "2026-01-01" });
    expect(validatePolicy({ perHoursWorked: 40 }, current, "2026-10-18").policy?.startsOn).toBe("2026-10-18");
    expect(validatePolicy({ annualCap: 48 }, current, "2026-10-18").policy?.startsOn).toBe("2026-01-01");
    expect(validatePolicy({ carryoverCap: null }, current, "2026-10-18").policy?.startsOn).toBe("2026-01-01");
  });

  it("an explicit start date wins", () => {
    expect(validatePolicy({ method: "per_period", startsOn: "2026-01-01" }, DEFAULT_POLICY, "2026-10-18").policy?.startsOn).toBe("2026-01-01");
  });

  it("turning it off clears the start", () => {
    expect(validatePolicy({ method: "none" }, policy({ method: "per_period" }), "2026-10-18").policy?.startsOn).toBeNull();
  });

  it.each([
    [{ method: "weekly" }, "method"],
    [{ hoursEarned: 0 }, "hoursEarned"],
    [{ hoursEarned: -1 }, "hoursEarned"],
    [{ perHoursWorked: "30" }, "perHoursWorked"],
    [{ period: "year" }, "period"],
    [{ annualCap: -5 }, "annualCap"],
    [{ carryoverCap: Infinity }, "carryoverCap"],
    [{ startsOn: "10/18/2026" }, "startsOn"],
  ])("refuses %j", (patch, field) => {
    const r = validatePolicy(patch, DEFAULT_POLICY, "2026-10-18");
    expect(r.policy).toBeNull();
    expect(r.error).toContain(field);
  });

  it("refuses a non-object", () => {
    expect(validatePolicy(null, DEFAULT_POLICY).error).toBeTruthy();
    expect(validatePolicy([1], DEFAULT_POLICY).error).toBeTruthy();
  });

  it("describes itself", () => {
    expect(describePolicy(DEFAULT_POLICY)).toBe("No accrual");
    expect(describePolicy(policy({ method: "per_hours_worked", annualCap: 40 }))).toBe("1 h per 30 h worked, up to 40 h a year");
    expect(describePolicy(policy({ method: "per_period", hoursEarned: 8, carryoverCap: 16 }))).toBe("8 h per month, 16 h carry over");
  });
});

describe("accrualWindow", () => {
  it("is null when the policy is off or nothing has closed", () => {
    expect(accrualWindow(DEFAULT_POLICY, "2026-10-18")).toBeNull();
    expect(accrualWindow(policy({ method: "per_period", startsOn: "2026-10-18" }), "2026-10-18")).toBeNull();
  });
  it("runs through yesterday from the policy start", () => {
    expect(accrualWindow(policy({ method: "per_period", startsOn: "2026-06-01" }), "2026-10-18"))
      .toEqual({ windowStart: "2026-06-01", through: "2026-10-17" });
  });
  it("reaches back no further than January 1 of last year", () => {
    expect(accrualWindow(policy({ method: "per_period", startsOn: "2020-01-01" }), "2026-10-18"))
      .toEqual({ windowStart: "2025-01-01", through: "2026-10-17" });
  });
  it("on January 1 still covers last year (for its carryover)", () => {
    expect(accrualWindow(policy({ method: "per_period", startsOn: "2020-01-01" }), "2027-01-01"))
      .toEqual({ windowStart: "2025-01-01", through: "2026-12-31" });
  });
});

describe("accrualPeriods", () => {
  it("hours worked: payroll workweeks (Monday start), only closed ones", () => {
    const p = policy({ method: "per_hours_worked", startsOn: "2026-10-05" }); // a Monday
    expect(accrualPeriods(p, { windowStart: "2026-10-05", through: "2026-10-17" })).toEqual([
      { start: "2026-10-05", end: "2026-10-11" },
    ]);
    expect(accrualPeriods(p, { windowStart: "2026-10-05", through: "2026-10-18" })).toEqual([
      { start: "2026-10-05", end: "2026-10-11" },
      { start: "2026-10-12", end: "2026-10-18" },
    ]);
  });
  it("hours worked: the first period starts on the policy's first day", () => {
    const p = policy({ method: "per_hours_worked", startsOn: "2026-10-08" });
    expect(accrualPeriods(p, { windowStart: "2026-10-08", through: "2026-10-18" })[0]).toEqual({ start: "2026-10-08", end: "2026-10-11" });
  });
  it("hours worked: a week across New Year splits at January 1", () => {
    const p = policy({ method: "per_hours_worked", startsOn: "2026-12-28" });
    expect(accrualPeriods(p, { windowStart: "2026-12-28", through: "2027-01-03" })).toEqual([
      { start: "2026-12-28", end: "2026-12-31" },
      { start: "2027-01-01", end: "2027-01-03" },
    ]);
  });
  it("hours worked: a week across a DST change is one period", () => {
    const p = policy({ method: "per_hours_worked", startsOn: "2026-10-26" });
    expect(accrualPeriods(p, { windowStart: "2026-10-26", through: "2026-11-01" })).toEqual([
      { start: "2026-10-26", end: "2026-11-01" },
    ]);
  });
  it("monthly: whole months from the start, dated the last day", () => {
    const p = policy({ method: "per_period", period: "month", startsOn: "2026-01-15" });
    expect(accrualPeriods(p, { windowStart: "2026-01-15", through: "2026-04-29" })).toEqual([
      { start: "2026-02-01", end: "2026-02-28" },
      { start: "2026-03-01", end: "2026-03-31" },
    ]);
  });
  it("monthly: a month starting on the policy's first day counts", () => {
    const p = policy({ method: "per_period", period: "month", startsOn: "2028-02-01" });
    expect(accrualPeriods(p, { windowStart: "2028-02-01", through: "2028-02-29" })).toEqual([
      { start: "2028-02-01", end: "2028-02-29" },
    ]);
  });
  it("semimonthly: the 1st–15th and 16th–end", () => {
    const p = policy({ method: "per_period", period: "semimonthly", startsOn: "2026-04-01" });
    expect(accrualPeriods(p, { windowStart: "2026-04-01", through: "2026-04-30" })).toEqual([
      { start: "2026-04-01", end: "2026-04-15" },
      { start: "2026-04-16", end: "2026-04-30" },
    ]);
  });
  it("weekly: workweeks", () => {
    const p = policy({ method: "per_period", period: "week", startsOn: "2026-10-07" });
    expect(accrualPeriods(p, { windowStart: "2026-10-07", through: "2026-10-25" })).toEqual([
      { start: "2026-10-12", end: "2026-10-18" },
      { start: "2026-10-19", end: "2026-10-25" },
    ]);
  });
  it("biweekly: two-week periods from the workweek the policy started in", () => {
    const p = policy({ method: "per_period", period: "biweekly", startsOn: "2026-10-05" });
    expect(accrualPeriods(p, { windowStart: "2026-10-05", through: "2026-11-01" })).toEqual([
      { start: "2026-10-05", end: "2026-10-18" },
      { start: "2026-10-19", end: "2026-11-01" },
    ]);
  });
  it("fixed: only periods ending inside the window", () => {
    const p = policy({ method: "per_period", period: "month", startsOn: "2024-01-01" });
    const periods = accrualPeriods(p, { windowStart: "2025-01-01", through: "2025-03-31" });
    expect(periods.map((x) => x.end)).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
  });
});

describe("computeAccrualEntries — hours worked", () => {
  const p = policy({ method: "per_hours_worked", hoursEarned: 1, perHoursWorked: 30, startsOn: "2026-10-05" });
  const window = { windowStart: "2026-10-05", through: "2026-10-18" };
  const emp = [{ id: 1, startDate: null, endDate: null }];

  it("earns exactly 1 h for 30 h", () => {
    const e = computeAccrualEntries({ policy: p, window, employees: emp, workedByDay: { 1: { "2026-10-05": 10, "2026-10-06": 10, "2026-10-07": 10 } } });
    expect(e).toEqual([{ employeeId: 1, periodStart: "2026-10-05", periodEnd: "2026-10-11", hours: 1, workedHours: 30 }]);
  });

  it("rounds down just under the threshold, and carries the remainder", () => {
    const e = computeAccrualEntries({
      policy: p, window, employees: emp,
      workedByDay: { 1: { "2026-10-05": 29.99, "2026-10-12": 0.01 } },
    });
    expect(e.map((x) => x.hours)).toEqual([0.99, 0.01]);
    expect(e.reduce((s, x) => s + x.hours, 0)).toBeCloseTo(1, 10);
  });

  it("is proportional (40 h → 1.33 h) without drifting over many weeks", () => {
    const days: Record<string, number> = {};
    const w = { windowStart: "2026-01-05", through: "2026-12-27" };
    for (let d = 0; d < 51 * 7; d += 7) {
      const date = new Date(Date.UTC(2026, 0, 5 + d)).toISOString().slice(0, 10);
      days[date] = 40;
    }
    const e = computeAccrualEntries({ policy: { ...p, startsOn: "2026-01-05" }, window: w, employees: emp, workedByDay: { 1: days } });
    expect(e[0].hours).toBe(1.33);
    const total = Math.round(e.reduce((s, x) => s + x.hours * 100, 0)) / 100;
    expect(total).toBe(68); // 51 × 40 = 2040 h / 30
  });

  it("does not post a week with no hours", () => {
    expect(computeAccrualEntries({ policy: p, window, employees: emp, workedByDay: {} })).toEqual([]);
  });

  it("stops at the annual cap, exactly", () => {
    const capped = { ...p, annualCap: 1.5 };
    const e = computeAccrualEntries({
      policy: capped, window, employees: emp,
      workedByDay: { 1: { "2026-10-05": 30, "2026-10-12": 30 } },
    });
    expect(e.map((x) => x.hours)).toEqual([1, 0.5]);
  });

  it("a cap of 0 earns nothing but still records the hours worked", () => {
    const e = computeAccrualEntries({ policy: { ...p, annualCap: 0 }, window, employees: emp, workedByDay: { 1: { "2026-10-05": 30 } } });
    expect(e).toEqual([{ employeeId: 1, periodStart: "2026-10-05", periodEnd: "2026-10-11", hours: 0, workedHours: 30 }]);
  });

  it("the cap resets on January 1", () => {
    const yearEnd = { ...p, annualCap: 1, startsOn: "2026-12-21" };
    const e = computeAccrualEntries({
      policy: yearEnd,
      window: { windowStart: "2026-12-21", through: "2027-01-10" },
      employees: emp,
      workedByDay: { 1: { "2026-12-21": 30, "2026-12-30": 30, "2027-01-01": 30, "2027-01-04": 30 } },
    });
    expect(e.map((x) => [x.periodStart, x.periodEnd, x.hours])).toEqual([
      ["2026-12-21", "2026-12-27", 1],
      ["2026-12-28", "2026-12-31", 0],
      ["2027-01-01", "2027-01-03", 1],
      ["2027-01-04", "2027-01-10", 0],
    ]);
  });

  it("hours worked on New Year's Eve and Day go to their own years", () => {
    const e = computeAccrualEntries({
      policy: { ...p, startsOn: "2026-12-28" },
      window: { windowStart: "2026-12-28", through: "2027-01-03" },
      employees: emp,
      workedByDay: { 1: { "2026-12-31": 15, "2027-01-01": 15 } },
    });
    expect(e.map((x) => [x.periodEnd, x.hours, x.workedHours])).toEqual([["2026-12-31", 0.5, 15], ["2027-01-03", 0.5, 15]]);
  });

  it("a DST week uses the hours payroll counted (a 9-hour fall-back night)", () => {
    const e = computeAccrualEntries({
      policy: { ...p, hoursEarned: 1, perHoursWorked: 3, startsOn: "2026-10-26" },
      window: { windowStart: "2026-10-26", through: "2026-11-01" },
      employees: emp,
      workedByDay: { 1: { "2026-11-01": 9 } },
    });
    expect(e[0].hours).toBe(3);
  });

  it("ignores days before the policy started", () => {
    const e = computeAccrualEntries({
      policy: { ...p, startsOn: "2026-10-08" },
      window: { windowStart: "2026-10-08", through: "2026-10-11" },
      employees: emp,
      workedByDay: { 1: { "2026-10-06": 30, "2026-10-09": 3 } },
    });
    expect(e).toEqual([{ employeeId: 1, periodStart: "2026-10-08", periodEnd: "2026-10-11", hours: 0.1, workedHours: 3 }]);
  });

  it("is empty when the policy is off", () => {
    expect(computeAccrualEntries({ policy: DEFAULT_POLICY, window, employees: emp, workedByDay: { 1: { "2026-10-05": 40 } } })).toEqual([]);
  });
});

describe("computeAccrualEntries — fixed per period", () => {
  const p = policy({ method: "per_period", period: "month", hoursEarned: 8, startsOn: "2026-01-01" });
  const window = { windowStart: "2026-01-01", through: "2026-06-30" };

  it("credits every whole month", () => {
    const e = computeAccrualEntries({ policy: p, window, employees: [{ id: 1, startDate: null, endDate: null }], workedByDay: {} });
    expect(e.map((x) => [x.periodEnd, x.hours])).toEqual([
      ["2026-01-31", 8], ["2026-02-28", 8], ["2026-03-31", 8], ["2026-04-30", 8], ["2026-05-31", 8], ["2026-06-30", 8],
    ]);
    expect(e.every((x) => x.workedHours === null)).toBe(true);
  });

  it("only months employed throughout", () => {
    const e = computeAccrualEntries({
      policy: p, window,
      employees: [{ id: 2, startDate: "2026-02-10", endDate: "2026-05-20" }],
      workedByDay: {},
    });
    expect(e.map((x) => x.periodEnd)).toEqual(["2026-03-31", "2026-04-30"]);
  });

  it("a hire on the first of the month counts that month", () => {
    const e = computeAccrualEntries({ policy: p, window, employees: [{ id: 3, startDate: "2026-06-01", endDate: null }], workedByDay: {} });
    expect(e.map((x) => x.periodEnd)).toEqual(["2026-06-30"]);
  });

  it("the annual cap trims the period that reaches it", () => {
    const e = computeAccrualEntries({ policy: { ...p, annualCap: 20 }, window, employees: [{ id: 1, startDate: null, endDate: null }], workedByDay: {} });
    expect(e.map((x) => x.hours)).toEqual([8, 8, 4]);
  });

  it("the cap resets with the year", () => {
    const e = computeAccrualEntries({
      policy: { ...p, annualCap: 8, startsOn: "2026-11-01" },
      window: { windowStart: "2026-11-01", through: "2027-01-31" },
      employees: [{ id: 1, startDate: null, endDate: null }],
      workedByDay: {},
    });
    expect(e.map((x) => [x.periodEnd, x.hours])).toEqual([["2026-11-30", 8], ["2027-01-31", 8]]);
  });
});

describe("paidLeaveByEmployeeDay", () => {
  it("splits PTO and sick per employee and day", () => {
    const m = paidLeaveByEmployeeDay([
      { employeeId: 1, date: "2026-10-05", leaveType: "pto", hours: 8 },
      { employeeId: 1, date: "2026-10-06", leaveType: "sick", hours: 4.5 },
      { employeeId: 2, date: "2026-10-05", leaveType: "sick", hours: 8 },
    ]);
    expect(m.get(1)?.get("2026-10-05")).toEqual({ ptoHours: 8, sickHours: 0 });
    expect(m.get(1)?.get("2026-10-06")).toEqual({ ptoHours: 0, sickHours: 4.5 });
    expect(m.get(2)?.get("2026-10-05")).toEqual({ ptoHours: 0, sickHours: 8 });
  });
  it("is empty for no days", () => {
    expect(paidLeaveByEmployeeDay([]).size).toBe(0);
  });
});
