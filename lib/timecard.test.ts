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

describe("computeTimecard — punches that don't pair up (timekeeping audit)", () => {
  it("flags a doubled clock-in and counts from the first one", () => {
    const tc = run({ punches: [punch("clock_in", 8, 0), punch("clock_in", 12, 0), punch("clock_out", 16, 0)] });
    expect(tc.days[0].workedHours).toBe(8);
    expect(tc.days[0].hasIncomplete).toBe(true);
  });

  it("flags a break end with no break start", () => {
    const tc = run({ punches: [punch("clock_in", 8, 0), punch("break_end", 12, 0), punch("clock_out", 16, 0)] });
    expect(tc.days[0].hasIncomplete).toBe(true);
    expect(tc.days[0].workedHours).toBe(8);
  });

  it("flags a clock-out with no clock-in", () => {
    const tc = run({ punches: [punch("clock_out", 16, 0)] });
    expect(tc.days[0].hasIncomplete).toBe(true);
  });

  it("keeps a clean day unflagged", () => {
    const tc = run({ punches: [punch("clock_in", 8, 0), punch("break_start", 12, 0), punch("break_end", 12, 30), punch("clock_out", 16, 0)] });
    expect(tc.days[0].hasIncomplete).toBe(false);
    expect(tc.days[0].workedHours).toBe(7.5);
  });

  it("orders punches stamped the same instant by id", () => {
    const a = punch("clock_in", 8, 0), b = punch("break_start", 12, 0), c = punch("break_end", 12, 0), d = punch("clock_out", 16, 0);
    const tc = run({ punches: [d, c, b, a] });
    expect(tc.days[0].punches.map((p) => p.punchType)).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
    expect(tc.days[0].hasIncomplete).toBe(false);
  });
});

describe("computeTimecard — totals (timekeeping audit)", () => {
  it("sums exact worked time and rounds once", () => {
    // Three days of 8h 0m 20s (8.0056h, shown 8.01) total 24.02h, not 24.03.
    const at = (d: string, hms: string) => `2026-01-${d}T${hms}-05:00`;
    const punches: TimecardPunchInput[] = [];
    for (const d of ["13", "14", "15"]) {
      punches.push({ id: nextId++, punchType: "clock_in", punchedAt: at(d, "08:00:00") });
      punches.push({ id: nextId++, punchType: "clock_out", punchedAt: at(d, "16:00:20") });
    }
    const tc = computeTimecard({
      employeeId: 1, employeeName: "T", from: "2026-01-13", to: "2026-01-15", timezone: TZ,
      policy: DEFAULT_PUNCH_POLICY, schedules: [], punches, callouts: [], nowMs: Date.parse("2026-01-16T00:00:00Z"),
    });
    expect(tc.days.map((d) => d.workedHours)).toEqual([8.01, 8.01, 8.01]);
    expect(tc.totalWorkedHours).toBe(24.02);
  });
});

// ── Edge cases from the time card audit (2026-10) ───────────────────────────
// Times are EST (−05:00) unless a test says otherwise.

const types = (tc: ReturnType<typeof runRange>, i = 0) => tc.days[i].violations.map((v) => v.type);
const lateNight = { lateOutEnabled: true, earlyInEnabled: true };

describe("computeTimecard — clock-ins on the other side of midnight", () => {
  it("puts an 11:50 PM clock-in for a midnight shift on the shift's day, with no NCNS", () => {
    const tc = runRange({
      from: "2026-01-14", to: "2026-01-15", policy: lateNight,
      schedules: [{ date: "2026-01-15", startMinutes: 0, endMinutes: 480 }],
      punches: [at("2026-01-14T23:50:00-05:00", "clock_in"), at("2026-01-15T08:00:00-05:00", "clock_out")],
    });
    // Before: Jan 14 showed the punches as unscheduled, and Jan 15 a false NCNS.
    expect(tc.days.map((d) => d.date)).toEqual(["2026-01-15"]);
    expect(tc.days[0].workedHours).toBeCloseTo(8.17, 2);
    expect(tc.days[0].punches[0].localMinutes).toBe(-10);
    expect(types(tc)).toEqual([]);
  });

  it("flags a big early arrival before midnight as early-in, not a no-show", () => {
    const tc = runRange({
      from: "2026-01-14", to: "2026-01-15", policy: { earlyInEnabled: true, earlyInMinutes: 15 },
      schedules: [{ date: "2026-01-15", startMinutes: 60, endMinutes: 540 }], // 1 AM
      punches: [at("2026-01-14T23:30:00-05:00", "clock_in"), at("2026-01-15T09:00:00-05:00", "clock_out")],
    });
    expect(tc.days.map((d) => d.date)).toEqual(["2026-01-15"]);
    expect(tc.days[0].violations.map((v) => [v.type, v.minutes])).toEqual([["early_in", 90]]);
  });

  it("judges a 12:10 AM clock-in for an 11 PM shift as 70 min late, not a no-show", () => {
    const tc = runRange({
      from: "2026-01-14", to: "2026-01-15",
      schedules: [{ date: "2026-01-14", startMinutes: 1380, endMinutes: 1860 }], // 11 PM – 7 AM
      punches: [at("2026-01-15T00:10:00-05:00", "clock_in"), at("2026-01-15T07:00:00-05:00", "clock_out")],
    });
    // Before: a false NCNS on Jan 14 and unscheduled punches on Jan 15.
    expect(tc.days.map((d) => d.date)).toEqual(["2026-01-14"]);
    expect(tc.days[0].violations.map((v) => [v.type, v.minutes])).toEqual([["late_in", 70]]);
    expect(tc.days[0].punches[0].localMinutes).toBe(1450);
  });

  it("matches across the range edge when the shift's day is outside the range", () => {
    // Only Jan 14 asked for; the clock-in belongs to Jan 15's midnight shift.
    const tc = runRange({
      from: "2026-01-14", to: "2026-01-14",
      schedules: [{ date: "2026-01-15", startMinutes: 0, endMinutes: 480 }],
      punches: [at("2026-01-14T23:50:00-05:00", "clock_in"), at("2026-01-15T08:00:00-05:00", "clock_out")],
    });
    expect(tc.days).toEqual([]);
  });

  it("scores a scheduled overnight shift's clock-out against the next morning", () => {
    const tc = runRange({
      from: "2026-01-14", to: "2026-01-15", policy: lateNight,
      schedules: [{ date: "2026-01-14", startMinutes: 1320, endMinutes: 1800 }], // 10 PM – 6 AM
      punches: [at("2026-01-14T22:00:00-05:00", "clock_in"), at("2026-01-15T06:30:00-05:00", "clock_out")],
    });
    expect(tc.days[0].violations.map((v) => [v.type, v.minutes])).toEqual([["late_out", 30]]);
  });

  it("drops a shift that began the night before `from` (it belongs to that day)", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15", schedules: [],
      punches: [
        at("2026-01-14T20:00:00-05:00", "clock_in"), at("2026-01-14T23:30:00-05:00", "break_start"),
        at("2026-01-15T00:30:00-05:00", "break_end"), at("2026-01-15T02:00:00-05:00", "clock_out"),
      ],
    });
    expect(tc.days).toEqual([]);
  });
});

describe("computeTimecard — split shifts", () => {
  const split = [
    { date: "2026-01-15", startMinutes: 480, endMinutes: 720 },   // 8 AM – noon
    { date: "2026-01-15", startMinutes: 1020, endMinutes: 1260 }, // 5 – 9 PM
  ];

  it("judges each shift on its own: late for the second, nothing false on the first", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15", policy: lateNight, schedules: split,
      punches: [
        at("2026-01-15T08:00:00-05:00", "clock_in"), at("2026-01-15T12:00:00-05:00", "clock_out"),
        at("2026-01-15T17:30:00-05:00", "clock_in"), at("2026-01-15T21:00:00-05:00", "clock_out"),
      ],
    });
    // Before: only the 5 PM shift was kept, so the 8 AM clock-in was a
    // 540-min early-in and the 30-min-late return wasn't flagged.
    expect(tc.days[0].violations.map((v) => [v.type, v.minutes])).toEqual([["late_in", 30]]);
    expect(tc.days[0].schedules).toEqual([
      { startMinutes: 480, endMinutes: 720 }, { startMinutes: 1020, endMinutes: 1260 },
    ]);
    expect(tc.days[0].schedule).toEqual({ startMinutes: 480, endMinutes: 720 });
    expect(tc.days[0].workedHours).toBe(7.5);
  });

  it("flags a no-show for the second shift when only the first was worked", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15", policy: lateNight, schedules: split,
      punches: [at("2026-01-15T08:00:00-05:00", "clock_in"), at("2026-01-15T12:00:00-05:00", "clock_out")],
    });
    expect(tc.days[0].violations.map((v) => [v.type, v.scheduledMinutes])).toEqual([["ncns", 1020]]);
  });

  it("flags the first shift as missed when only the second was worked", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15", schedules: split,
      punches: [at("2026-01-15T17:00:00-05:00", "clock_in"), at("2026-01-15T21:00:00-05:00", "clock_out")],
    });
    expect(tc.days[0].violations.map((v) => [v.type, v.scheduledMinutes])).toEqual([["ncns", 480]]);
  });

  it("does not call a shift missed when it was worked straight through from the first", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15", schedules: split,
      punches: [at("2026-01-15T08:00:00-05:00", "clock_in"), at("2026-01-15T21:00:00-05:00", "clock_out")],
    });
    expect(types(tc)).not.toContain("ncns");
  });

  it("treats back-to-back shifts as one block (no early-out at the handover)", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15", policy: lateNight,
      schedules: [
        { date: "2026-01-15", startMinutes: 480, endMinutes: 720 },
        { date: "2026-01-15", startMinutes: 720, endMinutes: 960 },
      ],
      punches: [at("2026-01-15T08:00:00-05:00", "clock_in"), at("2026-01-15T16:00:00-05:00", "clock_out")],
    });
    expect(types(tc)).toEqual([]);
    expect(tc.days[0].schedules).toEqual([{ startMinutes: 480, endMinutes: 960 }]);
  });

  it("keeps a lunch clock-out/in inside one shift on that shift", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15", policy: lateNight,
      schedules: [{ date: "2026-01-15", startMinutes: 480, endMinutes: 960 }],
      punches: [
        at("2026-01-15T08:00:00-05:00", "clock_in"), at("2026-01-15T12:00:00-05:00", "clock_out"),
        at("2026-01-15T12:30:00-05:00", "clock_in"), at("2026-01-15T16:00:00-05:00", "clock_out"),
      ],
    });
    expect(types(tc)).toEqual([]);
    expect(tc.days[0].workedHours).toBe(7.5);
    expect(tc.days[0].hasIncomplete).toBe(false);
  });
});

describe("computeTimecard — other edge cases", () => {
  it("does not flag an early-out for a shift still in progress", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15",
      schedules: [{ date: "2026-01-15", startMinutes: 480, endMinutes: 960 }],
      punches: [at("2026-01-15T08:00:00-05:00", "clock_in")],
      nowMs: Date.parse("2026-01-15T12:00:00-05:00"),
    });
    expect(types(tc)).toEqual([]);
    expect(tc.days[0].hasIncomplete).toBe(true);
  });

  it("does not flag NCNS for a shift that hasn't started", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-15",
      schedules: [{ date: "2026-01-15", startMinutes: 1020, endMinutes: 1260 }],
      punches: [],
      nowMs: Date.parse("2026-01-15T12:00:00-05:00"),
    });
    expect(types(tc)).toEqual([]);
  });

  it("shows hours worked on a called-out day, never with an NCNS (arriving later still counts as late)", () => {
    const tc = run({ callouts: [{ date: DATE, reason: "sick" }], punches: [punch("clock_in", 13, 0), punch("clock_out", 16, 0)] });
    expect(tc.days[0].workedHours).toBe(3);
    expect(tc.days[0].violations.map((v) => v.type)).toEqual(["callout", "late_in"]);
  });

  it("lists unscheduled work as its own day next to a missed scheduled day", () => {
    const tc = runRange({
      from: "2026-01-15", to: "2026-01-16",
      schedules: [{ date: "2026-01-15", startMinutes: 480, endMinutes: 960 }],
      punches: [at("2026-01-16T08:00:00-05:00", "clock_in"), at("2026-01-16T16:00:00-05:00", "clock_out")],
    });
    expect(tc.days.map((d) => [d.date, d.violations.map((v) => v.type)])).toEqual([
      ["2026-01-15", ["ncns"]], ["2026-01-16", []],
    ]);
  });

  it("is on time for a shift scheduled in the hour skipped by spring-forward", () => {
    // 2:30 AM doesn't exist on Mar 8 2026; the shift starts at 3:30 AM EDT.
    const tc = runRange({
      from: "2026-03-08", to: "2026-03-08",
      schedules: [{ date: "2026-03-08", startMinutes: 150, endMinutes: 600 }],
      punches: [at("2026-03-08T03:30:00-04:00", "clock_in"), at("2026-03-08T10:00:00-04:00", "clock_out")],
      nowMs: Date.parse("2026-03-09T00:00:00Z"),
    });
    expect(types(tc)).toEqual([]);
    expect(tc.days[0].workedHours).toBe(6.5);
  });

  it("matches an overnight shift on the fall-back night", () => {
    // 10 PM Oct 31 – 6 AM Nov 1 2026 is 9 real hours; clock-in 12:20 AM is 140 min late.
    const tc = runRange({
      from: "2026-10-31", to: "2026-11-01",
      schedules: [{ date: "2026-10-31", startMinutes: 1320, endMinutes: 1800 }],
      punches: [at("2026-11-01T00:20:00-04:00", "clock_in"), at("2026-11-01T06:00:00-05:00", "clock_out")],
      nowMs: Date.parse("2026-11-02T00:00:00Z"),
    });
    expect(tc.days.map((d) => d.date)).toEqual(["2026-10-31"]);
    expect(tc.days[0].violations.map((v) => [v.type, v.minutes])).toEqual([["late_in", 140]]);
    expect(tc.days[0].workedHours).toBeCloseTo(6.67, 2);
  });
});
