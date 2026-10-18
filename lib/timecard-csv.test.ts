import { describe, it, expect } from "vitest";
import { computeTimecard, type TimecardPunchInput } from "./timecard";
import { timecardToCsv } from "./timecard-csv";
import { DEFAULT_PUNCH_POLICY, type PunchPolicy } from "./punch-policy";

const TZ = "America/New_York";
const DATE = "2026-01-15";

function est(hh: number, mm: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${DATE}T${p(hh)}:${p(mm)}:00-05:00`;
}

let nextId = 1;
function punch(punchType: TimecardPunchInput["punchType"], hh: number, mm: number): TimecardPunchInput {
  return { id: nextId++, punchType, punchedAt: est(hh, mm) };
}

const schedule = { date: DATE, startMinutes: 540, endMinutes: 1020 }; // 9:00 AM – 5:00 PM

function build(overrides: {
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

function rows(csv: string): string[] {
  return csv.split("\n");
}

describe("timecardToCsv", () => {
  it("emits a header row", () => {
    const csv = timecardToCsv(build({ punches: [] }));
    expect(rows(csv)[0]).toBe("Date,Day,Type,Time,Flag,Detail,Manual,Note,Paid Leave Hrs");
  });

  it("flags the clock-in punch row with the late-in violation", () => {
    const csv = timecardToCsv(build({ punches: [punch("clock_in", 9, 20), punch("clock_out", 17, 0)] }));
    const clockInRow = rows(csv).find((r) => r.includes("Clock In"))!;
    expect(clockInRow).toContain("Late In");
    // The clock-out row carries no flag.
    const clockOutRow = rows(csv).find((r) => r.startsWith(`${DATE},`) && r.includes("Clock Out"))!;
    expect(clockOutRow).not.toContain("Late In");
  });

  it("attaches a long-break flag to the break-end row, not the break-start", () => {
    const csv = timecardToCsv(build({
      punches: [
        punch("clock_in", 9, 0),
        punch("break_start", 12, 0),
        punch("break_end", 12, 50),
        punch("clock_out", 17, 0),
      ],
      policy: { longBreakEnabled: true, longBreakMinutes: 35 },
    }));
    const breakEnd = rows(csv).find((r) => r.includes("Break End"))!;
    const breakStart = rows(csv).find((r) => r.includes("Break Start"))!;
    expect(breakEnd).toContain("Long Break");
    expect(breakStart).not.toContain("Long Break");
  });

  it("renders a no-show as an NCNS row stamped with the shift start time", () => {
    // Scheduled, never clocked in, well past the grace window.
    const csv = timecardToCsv(build({ punches: [] }));
    const ncnsRow = rows(csv).find((r) => r.includes("No Call No Show"));
    expect(ncnsRow).toBeDefined();
    expect(ncnsRow).toContain("NCNS");
    expect(ncnsRow).toContain("9:00 AM");
  });

  it("renders a call-out as its own row with the reason", () => {
    const csv = timecardToCsv(build({
      punches: [],
      callouts: [{ date: DATE, reason: "Sick" }],
    }));
    const calloutRow = rows(csv).find((r) => r.includes("Call Out"))!;
    expect(calloutRow).toContain("9:00 AM");
    expect(calloutRow).toContain("Sick");
  });
});

describe("timecardToCsv — split shifts (time card audit)", () => {
  it("writes one NCNS row per missed shift, each at its own start time", () => {
    const tc = build({
      schedules: [
        { date: DATE, startMinutes: 480, endMinutes: 720 },
        { date: DATE, startMinutes: 1020, endMinutes: 1260 },
      ],
    });
    const ncns = rows(timecardToCsv(tc)).filter((r) => r.includes(",NCNS,"));
    expect(ncns).toHaveLength(2);
    expect(ncns[0]).toContain(",8:00 AM,");
    expect(ncns[1]).toContain(",5:00 PM,");
  });
});

describe("timecardToCsv — paid leave", () => {
  it("adds a leave row with its hours in the last column", () => {
    const csv = timecardToCsv(build({ punches: [punch("clock_in", 9, 0), punch("clock_out", 17, 0)] }), [
      { date: DATE, leaveType: "sick", hours: 2 },
    ]);
    const leaveRow = rows(csv).find((r) => r.includes(",Sick,"))!;
    expect(leaveRow).toBe(`${DATE},Thu,Sick,,,,,,2.00`);
  });

  it("a leave-only day comes in date order", () => {
    const csv = timecardToCsv(build({ punches: [punch("clock_in", 9, 0), punch("clock_out", 17, 0)] }), [
      { date: "2026-01-14", leaveType: "pto", hours: 8 },
      { date: "2026-01-16", leaveType: "pto", hours: 7.5 },
    ]);
    const lines = rows(csv);
    expect(lines[1]).toBe("2026-01-14,Wed,PTO,,,,,,8.00");
    expect(lines[lines.length - 1]).toBe("2026-01-16,Fri,PTO,,,,,,7.50");
    expect(lines.filter((l) => l.startsWith(DATE)).every((l) => l.endsWith(","))).toBe(true);
  });

  it("every row has the same number of columns", () => {
    const csv = timecardToCsv(build({ punches: [punch("clock_in", 9, 0)], callouts: [{ date: DATE, reason: "flu" }] }), [
      { date: DATE, leaveType: "pto", hours: 4 },
    ]);
    const counts = new Set(rows(csv).map((l) => l.split(",").length));
    expect(counts.size).toBe(1);
  });
});
