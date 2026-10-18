import { describe, it, expect } from "vitest";
import { resolveManualPunchTime } from "./manual-punch-time";

const tz = "America/New_York";
// Clocked in Oct 13 at 10 PM EDT and never clocked out.
const openClockIn = { punchType: "clock_in", punchedAt: "2026-10-14T02:00:00Z" };
const now = Date.parse("2026-10-15T14:00:00Z");

describe("resolveManualPunchTime", () => {
  it("moves a clock-out typed before the overnight clock-in to the next morning", () => {
    expect(resolveManualPunchTime("clock_out", "2026-10-13", 360, tz, openClockIn, now).toISOString())
      .toBe("2026-10-14T10:00:00.000Z"); // Oct 14, 6 AM EDT
  });

  it("does the same for break punches that follow the open punch", () => {
    expect(resolveManualPunchTime("break_start", "2026-10-13", 120, tz, openClockIn, now).toISOString())
      .toBe("2026-10-14T06:00:00.000Z");
    const onBreak = { punchType: "break_start", punchedAt: "2026-10-14T03:00:00Z" }; // 11 PM
    expect(resolveManualPunchTime("break_end", "2026-10-13", 30, tz, onBreak, now).toISOString())
      .toBe("2026-10-14T04:30:00.000Z");
  });

  it("keeps a time after the open punch on the day typed", () => {
    expect(resolveManualPunchTime("clock_out", "2026-10-13", 1410, tz, openClockIn, now).toISOString())
      .toBe("2026-10-14T03:30:00.000Z"); // Oct 13, 11:30 PM
  });

  it("never rolls a clock-in, or past a punch it can't follow", () => {
    expect(resolveManualPunchTime("clock_in", "2026-10-13", 360, tz, openClockIn, now).toISOString())
      .toBe("2026-10-13T10:00:00.000Z");
    const closed = { punchType: "clock_out", punchedAt: "2026-10-14T02:00:00Z" };
    expect(resolveManualPunchTime("clock_out", "2026-10-13", 360, tz, closed, now).toISOString())
      .toBe("2026-10-13T10:00:00.000Z");
    expect(resolveManualPunchTime("clock_out", "2026-10-13", 360, tz, null, now).toISOString())
      .toBe("2026-10-13T10:00:00.000Z");
  });

  it("only rolls from the open punch's own store day", () => {
    expect(resolveManualPunchTime("clock_out", "2026-10-12", 360, tz, openClockIn, now).toISOString())
      .toBe("2026-10-12T10:00:00.000Z");
  });

  it("never rolls into the future", () => {
    const early = Date.parse("2026-10-14T09:00:00Z"); // Oct 14, 5 AM — 6 AM hasn't happened yet
    expect(resolveManualPunchTime("clock_out", "2026-10-13", 360, tz, openClockIn, early).toISOString())
      .toBe("2026-10-13T10:00:00.000Z");
  });
});
