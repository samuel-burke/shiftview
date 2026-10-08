import { describe, it, expect } from "vitest";
import { getPunchWarning } from "./punch-warning";
import type { Schedule } from "@/data/types";

const schedule: Schedule = {
  id: 1,
  employeeId: 1,
  date: "2026-05-31",
  startMinutes: 480, // 8:00 AM
  endMinutes: 960,   // 4:00 PM
};

describe("getPunchWarning — clock_in", () => {
  it("returns null when schedule is null", () => {
    expect(getPunchWarning("clock_in", 480, null)).toBeNull();
  });

  it("returns null when exactly on time (diff = 0)", () => {
    expect(getPunchWarning("clock_in", 480, schedule)).toBeNull();
  });

  it("returns null when 6 minutes late (at threshold, not over)", () => {
    expect(getPunchWarning("clock_in", 486, schedule)).toBeNull();
  });

  it("returns null when 6 minutes early (at threshold, not over)", () => {
    expect(getPunchWarning("clock_in", 474, schedule)).toBeNull();
  });

  it("returns Late Clock-In warning when 7 minutes late", () => {
    const w = getPunchWarning("clock_in", 487, schedule);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Late Clock-In");
    expect(w!.diffMinutes).toBe(7);
    expect(w!.body).toContain("8:00 AM");
    expect(w!.body).toContain("7 min late");
  });

  it("returns Early Clock-In warning when 7 minutes early", () => {
    const w = getPunchWarning("clock_in", 473, schedule);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Early Clock-In");
    expect(w!.diffMinutes).toBe(-7);
    expect(w!.body).toContain("8:00 AM");
    expect(w!.body).toContain("7 min early");
  });

  it("returns warning with correct diff when 73 minutes late", () => {
    const w = getPunchWarning("clock_in", 553, schedule);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Late Clock-In");
    expect(w!.diffMinutes).toBe(73);
  });
});

describe("getPunchWarning — clock_out", () => {
  it("returns null when exactly on time", () => {
    expect(getPunchWarning("clock_out", 960, schedule)).toBeNull();
  });

  it("returns null when 6 minutes late (at threshold)", () => {
    expect(getPunchWarning("clock_out", 966, schedule)).toBeNull();
  });

  it("returns null when 6 minutes early (at threshold)", () => {
    expect(getPunchWarning("clock_out", 954, schedule)).toBeNull();
  });

  it("returns Late Clock-Out warning when 7 minutes late", () => {
    const w = getPunchWarning("clock_out", 967, schedule);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Late Clock-Out");
    expect(w!.diffMinutes).toBe(7);
    expect(w!.body).toContain("4:00 PM");
    expect(w!.body).toContain("7 min late");
  });

  it("returns Early Clock-Out warning when 7 minutes early", () => {
    const w = getPunchWarning("clock_out", 953, schedule);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Early Clock-Out");
    expect(w!.diffMinutes).toBe(-7);
    expect(w!.body).toContain("4:00 PM");
    expect(w!.body).toContain("7 min early");
  });
});

describe("getPunchWarning — other punch types", () => {
  it("returns null for break_start", () => {
    expect(getPunchWarning("break_start", 480, schedule)).toBeNull();
  });

  it("returns null for break_end", () => {
    expect(getPunchWarning("break_end", 480, schedule)).toBeNull();
  });
});

describe("getPunchWarning — DST-aware timing", () => {
  const fallBack: Schedule = { id: 2, employeeId: 1, date: "2026-11-01", startMinutes: 90, endMinutes: 540 };
  const tz = "America/New_York";

  it("warns at the repeated 1:30 AM on the fall-back night (an hour late in real time)", () => {
    // Wall clock reads 1:30 both times; only real elapsed time tells them apart.
    const second130 = Date.parse("2026-11-01T06:30:00Z");
    expect(getPunchWarning("clock_in", 90, fallBack)).toBeNull(); // wall-clock fallback
    const w = getPunchWarning("clock_in", 90, fallBack, { nowMs: second130, tz });
    expect(w?.heading).toBe("Late Clock-In");
    expect(w?.diffMinutes).toBe(60);
  });

  it("does not warn at the first 1:30 AM", () => {
    const first130 = Date.parse("2026-11-01T05:30:00Z");
    expect(getPunchWarning("clock_in", 90, fallBack, { nowMs: first130, tz })).toBeNull();
  });
});
