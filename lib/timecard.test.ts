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
  approvals?: { periodStart: string; periodEnd: string }[];
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
    approvals: overrides.approvals,
    nowMs: overrides.nowMs ?? new Date(est(23, 0)).getTime(),
  });
}

describe("computeTimecard — approval lock annotation", () => {
  const punches = [punch("clock_in", 8, 0), punch("clock_out", 16, 0)];

  it("marks a day locked when an approval covers it", () => {
    const tc = run({ punches, approvals: [{ periodStart: "2026-01-01", periodEnd: "2026-01-31" }] });
    expect(tc.days[0].locked).toBe(true);
  });

  it("leaves a day unlocked when no approval covers it", () => {
    const tc = run({ punches, approvals: [{ periodStart: "2026-02-01", periodEnd: "2026-02-28" }] });
    expect(tc.days[0].locked).toBe(false);
  });

  it("defaults locked to false when no approvals are passed", () => {
    expect(run({ punches }).days[0].locked).toBe(false);
  });
});

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
