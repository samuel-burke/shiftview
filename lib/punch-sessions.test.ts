import { describe, it, expect } from "vitest";
import { assignPunchDays, currentShift } from "./punch-sessions";

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

describe("currentShift — across midnight", () => {
  const p = (punchType: string, punchedAt: string) => ({ punchType, punchedAt });
  // New York, January (EST, UTC−5). The closer clocked in at 4:00 PM Jan 15.
  const closer = [p("clock_in", "2026-01-15T21:00:00Z")];
  const at = (iso: string) => Date.parse(iso);

  it("keeps a closer's shift current after midnight so they can clock out", () => {
    const s = currentShift(closer, at("2026-01-16T05:30:00Z"), TZ); // 00:30 Jan 16
    expect(s).toMatchObject({ state: "clock_in", carriedOver: true });
    expect(s.punches).toHaveLength(1);
  });

  it("continues the shift through breaks taken after midnight", () => {
    const punches = [...closer, p("break_start", "2026-01-16T05:10:00Z")];
    const s = currentShift(punches, at("2026-01-16T05:20:00Z"), TZ);
    expect(s).toMatchObject({ state: "break_start", carriedOver: true });
    expect(s.punches.map((x) => x.punchType)).toEqual(["clock_in", "break_start"]);
  });

  it("ends once the closer clocks out after midnight", () => {
    const punches = [...closer, p("clock_out", "2026-01-16T05:30:00Z")];
    const s = currentShift(punches, at("2026-01-16T06:00:00Z"), TZ);
    expect(s.state).toBe("clock_out");
    expect(s.carriedOver).toBe(false);
  });

  it("treats a shift still open after 4:00 AM as a forgotten clock-out", () => {
    // Forgot to clock out of an evening shift; it's 7:00 AM the next day.
    const s = currentShift(closer, at("2026-01-16T12:00:00Z"), TZ);
    expect(s).toEqual({ state: null, punches: [], carriedOver: false });
  });

  it("treats a shift that began over 16 hours ago as forgotten, even before 4:00 AM", () => {
    const morning = [p("clock_in", "2026-01-15T13:00:00Z")]; // 8:00 AM Jan 15
    const s = currentShift(morning, at("2026-01-16T06:00:00Z"), TZ); // 1:00 AM, 17h later
    expect(s.state).toBeNull();
  });

  it("never carries over a shift from two days ago", () => {
    const old = [p("clock_in", "2026-01-14T21:00:00Z")];
    expect(currentShift(old, at("2026-01-16T05:30:00Z"), TZ).state).toBeNull();
  });

  it("uses today's punches as normal during the day", () => {
    const punches = [...closer, p("clock_out", "2026-01-16T03:00:00Z"), p("clock_in", "2026-01-16T14:00:00Z")];
    const s = currentShift(punches, at("2026-01-16T15:00:00Z"), TZ);
    expect(s).toMatchObject({ state: "clock_in", carriedOver: false });
    expect(s.punches).toHaveLength(1);
  });

  it("handles a closer on the US fall-back night (25-hour day)", () => {
    // Clocked in 6:00 PM EDT Oct 31; it's 1:30 AM EST (the second 1:30) Nov 1.
    const s = currentShift([p("clock_in", "2026-10-31T22:00:00Z")], at("2026-11-01T06:30:00Z"), TZ);
    expect(s).toMatchObject({ state: "clock_in", carriedOver: true });
  });
});

describe("currentShift — scheduled overnight shifts", () => {
  const p = (punchType: string, punchedAt: string) => ({ punchType, punchedAt });
  const at = (iso: string) => Date.parse(iso);
  // 10 PM Jan 15 – 6 AM Jan 16 New York (EST): ends 11:00 UTC.
  const night = [p("clock_in", "2026-01-16T03:00:00Z")];
  const end = at("2026-01-16T11:00:00Z");

  it("keeps the shift current until its scheduled end, past 4:00 AM", () => {
    expect(currentShift(night, at("2026-01-16T11:15:00Z"), TZ, end)).toMatchObject({ state: "clock_in", carriedOver: true });
  });

  it("allows a late clock-out within two hours of the scheduled end", () => {
    expect(currentShift(night, at("2026-01-16T12:59:00Z"), TZ, end).state).toBe("clock_in");
  });

  it("treats it as forgotten after that", () => {
    expect(currentShift(night, at("2026-01-16T13:01:00Z"), TZ, end).state).toBeNull();
  });

  it("without a scheduled overnight shift, still ends at 4:00 AM", () => {
    expect(currentShift(night, at("2026-01-16T09:30:00Z"), TZ).state).toBeNull();
  });
});
