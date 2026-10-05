import { describe, it, expect } from "vitest";
import { assignPunchDays } from "./punch-sessions";

const TZ = "America/New_York";

describe("assignPunchDays", () => {
  it("assigns a shift that runs past midnight to the day it started", () => {
    const out = assignPunchDays([
      { punchType: "clock_in", punchedAt: "2026-01-15T21:00:00Z" },   // 16:00 Jan 15
      { punchType: "break_start", punchedAt: "2026-01-16T03:00:00Z" }, // 22:00
      { punchType: "break_end", punchedAt: "2026-01-16T03:30:00Z" },
      { punchType: "clock_out", punchedAt: "2026-01-16T05:30:00Z" },   // 00:30 Jan 16
      { punchType: "clock_in", punchedAt: "2026-01-16T21:00:00Z" },    // next shift
    ], TZ);
    expect(out.map((a) => a.day)).toEqual(["2026-01-15", "2026-01-15", "2026-01-15", "2026-01-15", "2026-01-16"]);
    expect(out[3].minutes).toBe(1440 + 30);
    expect(out[4].minutes).toBe(16 * 60);
  });

  it("measures post-midnight minutes in wall-clock terms on a DST night", () => {
    const out = assignPunchDays([
      { punchType: "clock_in", punchedAt: "2026-10-31T22:00:00Z" },  // 18:00 EDT Oct 31
      { punchType: "clock_out", punchedAt: "2026-11-01T06:30:00Z" }, // 01:30 EST (second 1:30)
    ], TZ);
    expect(out[1].day).toBe("2026-10-31");
    expect(out[1].minutes).toBe(1440 + 90);
  });

  it("treats punches more than 24h into an unclosed shift as a new day", () => {
    const out = assignPunchDays([
      { punchType: "clock_in", punchedAt: "2026-01-15T14:00:00Z" },
      { punchType: "break_start", punchedAt: "2026-01-17T14:00:00Z" },
    ], TZ);
    expect(out.map((a) => a.day)).toEqual(["2026-01-15", "2026-01-17"]);
  });

  it("buckets orphan punches (no prior clock-in) on their own day", () => {
    const out = assignPunchDays([{ punchType: "clock_out", punchedAt: "2026-01-16T05:30:00Z" }], TZ);
    expect(out[0]).toEqual({ day: "2026-01-16", minutes: 30 });
  });
});
