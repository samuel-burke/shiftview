import { describe, it, expect } from "vitest";
import { computeTimecard, type TimecardPunchInput } from "./timecard";
import { DEFAULT_PUNCH_POLICY, type PunchPolicy } from "./punch-policy";

// All fixtures use a January (EST, UTC−05:00) date so local↔UTC math is a fixed
// 5-hour offset with no DST ambiguity.
const TZ = "America/New_York";
const DATE = "2026-01-15";

// Build an ISO instant for HH:MM local Eastern Standard Time.
function est(hh: number, mm: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${DATE}T${p(hh)}:${p(mm)}:00-05:00`;
}

let nextId = 1;
function punch(punchType: TimecardPunchInput["punchType"], hh: number, mm: number): TimecardPunchInput {
  return { id: nextId++, punchType, punchedAt: est(hh, mm) };
}

const schedule = { date: DATE, startMinutes: 480, endMinutes: 960 }; // 8:00 AM – 4:00 PM

function run(overrides: {
  policy?: Partial<PunchPolicy>;
  punches?: TimecardPunchInput[];
  callouts?: { date: string; reason?: string | null }[];
  schedules?: { date: string; startMinutes: number; endMinutes: number }[];
  nowMs?: number;
}) {
  return computeTimecard({
    employeeId: 1,
    employeeName: "Test Employee",
    from: DATE,
    to: DATE,
    timezone: TZ,
    policy: { ...DEFAULT_PUNCH_POLICY, ...overrides.policy },
    schedules: overrides.schedules ?? [schedule],
    punches: overrides.punches ?? [],
    callouts: overrides.callouts ?? [],
    nowMs: overrides.nowMs ?? new Date(est(23, 0)).getTime(),
  });
}

describe("computeTimecard — late/early in", () => {
  it("flags a late clock-in over the threshold", () => {
    const tc = run({ punches: [punch("clock_in", 8, 10), punch("clock_out", 16, 0)] });
    const v = tc.days[0].violations.find((x) => x.type === "late_in");
    expect(v).toBeDefined();
    expect(v!.minutes).toBe(10);
    expect(tc.violationCounts.late_in).toBe(1);
  });

  it("does not flag a clock-in within the threshold", () => {
    const tc = run({ punches: [punch("clock_in", 8, 5), punch("clock_out", 16, 0)] });
    expect(tc.days[0].violations.some((x) => x.type === "late_in")).toBe(false);
  });

  it("flags an early clock-in only when the rule is enabled", () => {
    const punches = [punch("clock_in", 7, 30), punch("clock_out", 16, 0)];
    expect(run({ punches }).days[0].violations.some((x) => x.type === "early_in")).toBe(false);
    const tc = run({ punches, policy: { earlyInEnabled: true, earlyInMinutes: 15 } });
    expect(tc.days[0].violations.find((x) => x.type === "early_in")!.minutes).toBe(30);
  });
});

describe("computeTimecard — late/early out", () => {
  it("flags an early clock-out over the threshold (default policy)", () => {
    const tc = run({ punches: [punch("clock_in", 8, 0), punch("clock_out", 15, 30)] });
    const v = tc.days[0].violations.find((x) => x.type === "early_out");
    expect(v).toBeDefined();
    expect(v!.minutes).toBe(30);
  });

  it("flags a late clock-out only when enabled", () => {
    const punches = [punch("clock_in", 8, 0), punch("clock_out", 16, 30)];
    expect(run({ punches }).days[0].violations.some((x) => x.type === "late_out")).toBe(false);
    const tc = run({ punches, policy: { lateOutEnabled: true, lateOutMinutes: 15 } });
    expect(tc.days[0].violations.find((x) => x.type === "late_out")!.minutes).toBe(30);
  });
});

describe("computeTimecard — breaks", () => {
  it("flags a long break when enabled", () => {
    const punches = [
      punch("clock_in", 8, 0),
      punch("break_start", 12, 0),
      punch("break_end", 12, 40),
      punch("clock_out", 16, 0),
    ];
    const tc = run({ punches, policy: { longBreakEnabled: true, longBreakMinutes: 35 } });
    const v = tc.days[0].violations.find((x) => x.type === "long_break");
    expect(v).toBeDefined();
    expect(v!.minutes).toBe(40);
    expect(tc.days[0].breakCount).toBe(1);
  });

  it("flags a short break when enabled", () => {
    const punches = [
      punch("clock_in", 8, 0),
      punch("break_start", 12, 0),
      punch("break_end", 12, 10),
      punch("clock_out", 16, 0),
    ];
    const tc = run({ punches, policy: { shortBreakEnabled: true, shortBreakMinutes: 20 } });
    expect(tc.days[0].violations.find((x) => x.type === "short_break")!.minutes).toBe(10);
  });
});

describe("computeTimecard — call-out and NCNS", () => {
  it("flags a call-out and never also NCNS", () => {
    const tc = run({ callouts: [{ date: DATE, reason: "sick" }], punches: [] });
    expect(tc.violationCounts.callout).toBe(1);
    expect(tc.violationCounts.ncns).toBe(0);
  });

  it("flags NCNS when the grace window has elapsed", () => {
    // now = 11:00 EST, well past 8:00 start + 60 min grace
    const tc = run({ punches: [], nowMs: new Date(est(11, 0)).getTime() });
    expect(tc.violationCounts.ncns).toBe(1);
  });

  it("does not flag NCNS within the grace window", () => {
    // now = 8:30 EST, only 30 min past start
    const tc = run({ punches: [], nowMs: new Date(est(8, 30)).getTime() });
    expect(tc.violationCounts.ncns).toBe(0);
  });
});

describe("computeTimecard — totals & filtering", () => {
  it("computes worked and break hours", () => {
    const tc = run({
      punches: [
        punch("clock_in", 8, 0),
        punch("break_start", 12, 0),
        punch("break_end", 12, 30),
        punch("clock_out", 16, 0),
      ],
    });
    expect(tc.totalWorkedHours).toBeCloseTo(7.5, 5);
    expect(tc.totalBreakHours).toBeCloseTo(0.5, 5);
  });

  it("omits days with no schedule, punches, or call-out", () => {
    const tc = computeTimecard({
      employeeId: 1, employeeName: "E", from: "2026-01-15", to: "2026-01-17",
      timezone: TZ, policy: DEFAULT_PUNCH_POLICY,
      schedules: [], punches: [], callouts: [],
      nowMs: new Date(est(23, 0)).getTime(),
    });
    expect(tc.days).toHaveLength(0);
  });
});

// ── DST and overnight edge cases ──────────────────────────────────────────────

function at(iso: string, punchType: TimecardPunchInput["punchType"]): TimecardPunchInput {
  return { id: nextId++, punchType, punchedAt: iso };
}

function runRange(opts: {
  from: string;
  to: string;
  tz?: string;
  schedules: { date: string; startMinutes: number; endMinutes: number }[];
  punches: TimecardPunchInput[];
  policy?: Partial<PunchPolicy>;
  nowMs?: number;
}) {
  return computeTimecard({
    employeeId: 1,
    employeeName: "Test Employee",
    from: opts.from,
    to: opts.to,
    timezone: opts.tz ?? TZ,
    policy: { ...DEFAULT_PUNCH_POLICY, ...opts.policy },
    schedules: opts.schedules,
    punches: opts.punches,
    callouts: [],
    nowMs: opts.nowMs ?? Date.parse("2027-01-01T00:00:00Z"),
  });
}

describe("computeTimecard — DST changes", () => {
  it("pays the real 9 hours for a midnight–8 AM shift on the fall-back night", () => {
    const tc = runRange({
      from: "2026-11-01", to: "2026-11-01",
      schedules: [{ date: "2026-11-01", startMinutes: 0, endMinutes: 480 }],
      punches: [at("2026-11-01T04:00:00Z", "clock_in"), at("2026-11-01T13:00:00Z", "clock_out")], // 00:00 EDT → 08:00 EST
    });
    expect(tc.days).toHaveLength(1);
    expect(tc.days[0].workedHours).toBe(9);
    expect(tc.days[0].violations).toEqual([]); // on time in and out
  });

  it("pays the real 7 hours for a midnight–8 AM shift on the spring-forward night", () => {
    const tc = runRange({
      from: "2026-03-08", to: "2026-03-08",
      schedules: [{ date: "2026-03-08", startMinutes: 0, endMinutes: 480 }],
      punches: [at("2026-03-08T05:00:00Z", "clock_in"), at("2026-03-08T12:00:00Z", "clock_out")], // 00:00 EST → 08:00 EDT
    });
    expect(tc.days[0].workedHours).toBe(7);
    expect(tc.days[0].violations).toEqual([]);
  });

  it("keeps a 12:30 AM fall-back clock-in on its own day (not the previous one)", () => {
    const tc = runRange({
      from: "2026-10-31", to: "2026-11-01",
      schedules: [{ date: "2026-11-01", startMinutes: 30, endMinutes: 480 }],
      punches: [at("2026-11-01T04:30:00Z", "clock_in"), at("2026-11-01T13:00:00Z", "clock_out")],
    });
    expect(tc.days.map((d) => d.date)).toEqual(["2026-11-01"]);
    expect(tc.days[0].workedHours).toBe(8.5);
  });

  it("judges a clock-in at the repeated 1:30 AM as an hour late", () => {
    const tc = runRange({
      from: "2026-11-01", to: "2026-11-01",
      schedules: [{ date: "2026-11-01", startMinutes: 90, endMinutes: 540 }],
      punches: [at("2026-11-01T06:30:00Z", "clock_in"), at("2026-11-01T14:00:00Z", "clock_out")], // second 01:30 (EST)
    });
    const late = tc.days[0].violations.find((v) => v.type === "late_in");
    expect(late?.minutes).toBe(60);
  });

  it("flags NCNS at the right real time on a DST day", () => {
    // 9 AM shift on spring-forward day = 13:00Z; grace 60 min → NCNS from 14:00Z.
    const base = {
      from: "2026-03-08", to: "2026-03-08",
      schedules: [{ date: "2026-03-08", startMinutes: 540, endMinutes: 1020 }],
      punches: [],
    };
    expect(runRange({ ...base, nowMs: Date.parse("2026-03-08T13:59:00Z") }).violationCounts.ncns).toBe(0);
    expect(runRange({ ...base, nowMs: Date.parse("2026-03-08T14:01:00Z") }).violationCounts.ncns).toBe(1);
  });
});

describe("computeTimecard — shifts past midnight", () => {
  it("keeps a late close on the day it started, with no false early-out", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-16",
      schedules: [{ date: "2026-01-15", startMinutes: 960, endMinutes: 1440 }], // 4 PM – midnight
      punches: [at("2026-01-15T21:00:00Z", "clock_in"), at("2026-01-16T05:20:00Z", "clock_out")], // 16:00 → 00:20 EST
      policy: { lateOutEnabled: true, lateOutMinutes: 10 },
    });
    expect(tc.days.map((d) => d.date)).toEqual(["2026-01-15"]);
    expect(tc.days[0].workedHours).toBeCloseTo(8.33, 2);
    const types = tc.days[0].violations.map((v) => v.type);
    expect(types).toContain("late_out");
    expect(types).not.toContain("early_out");
  });

  it("does not let a forgotten clock-out swallow the next day's punches", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-17",
      schedules: [],
      punches: [
        at("2026-01-15T13:00:00Z", "clock_in"),   // never clocked out
        at("2026-01-17T13:00:00Z", "break_start"), // >24h later: its own day
      ],
    });
    expect(tc.days.map((d) => d.date)).toEqual(["2026-01-15", "2026-01-17"]);
    expect(tc.days[0].hasIncomplete).toBe(true);
  });

  it("buckets days in the store's timezone, whatever it is", () => {
    // 23:30 UTC Jan 15 is 05:15 Jan 16 in Kathmandu (+05:45).
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-16", tz: "Asia/Kathmandu",
      schedules: [],
      punches: [at("2026-01-15T23:30:00Z", "clock_in"), at("2026-01-16T08:30:00Z", "clock_out")],
    });
    expect(tc.days.map((d) => d.date)).toEqual(["2026-01-16"]);
    expect(tc.days[0].punches[0].localMinutes).toBe(5 * 60 + 15);
    expect(tc.days[0].workedHours).toBe(9);
  });
});
