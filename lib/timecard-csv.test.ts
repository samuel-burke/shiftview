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
    expect(rows(csv)[0]).toBe("Date,Day,Type,Time,Flag,Detail,Manual,Note");
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
