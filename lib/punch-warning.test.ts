import { describe, it, expect } from "vitest";
import { getPunchWarning } from "./punch-warning";
import type { Schedule } from "@/data/types";
import { DEFAULT_PUNCH_POLICY, type PunchPolicy } from "./punch-policy";

// Every early/late rule on at a 6-minute threshold, so both directions warn.
const ALL_ON: PunchPolicy = {
  ...DEFAULT_PUNCH_POLICY,
  lateInEnabled: true, lateInMinutes: 6,
  earlyInEnabled: true, earlyInMinutes: 6,
  lateOutEnabled: true, lateOutMinutes: 6,
  earlyOutEnabled: true, earlyOutMinutes: 6,
};

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
    expect(getPunchWarning("clock_in", 486, schedule, undefined, ALL_ON)).toBeNull();
  });

  it("returns null when 6 minutes early (at threshold, not over)", () => {
    expect(getPunchWarning("clock_in", 474, schedule, undefined, ALL_ON)).toBeNull();
  });

  it("returns Late Clock-In warning when 7 minutes late", () => {
    const w = getPunchWarning("clock_in", 487, schedule, undefined, ALL_ON);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Late Clock-In");
    expect(w!.diffMinutes).toBe(7);
    expect(w!.body).toContain("8:00 AM");
    expect(w!.body).toContain("7 min late");
  });

  it("returns Early Clock-In warning when 7 minutes early", () => {
    const w = getPunchWarning("clock_in", 473, schedule, undefined, ALL_ON);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Early Clock-In");
    expect(w!.diffMinutes).toBe(-7);
    expect(w!.body).toContain("8:00 AM");
    expect(w!.body).toContain("7 min early");
  });

  it("returns warning with correct diff when 73 minutes late", () => {
    const w = getPunchWarning("clock_in", 553, schedule, undefined, ALL_ON);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Late Clock-In");
    expect(w!.diffMinutes).toBe(73);
  });
});

describe("getPunchWarning — clock_out", () => {
  it("returns null when exactly on time", () => {
    expect(getPunchWarning("clock_out", 960, schedule, undefined, ALL_ON)).toBeNull();
  });

  it("returns null when 6 minutes late (at threshold)", () => {
    expect(getPunchWarning("clock_out", 966, schedule, undefined, ALL_ON)).toBeNull();
  });

  it("returns null when 6 minutes early (at threshold)", () => {
    expect(getPunchWarning("clock_out", 954, schedule, undefined, ALL_ON)).toBeNull();
  });

  it("returns Late Clock-Out warning when 7 minutes late", () => {
    const w = getPunchWarning("clock_out", 967, schedule, undefined, ALL_ON);
    expect(w).not.toBeNull();
    expect(w!.heading).toBe("Late Clock-Out");
    expect(w!.diffMinutes).toBe(7);
    expect(w!.body).toContain("4:00 PM");
    expect(w!.body).toContain("7 min late");
  });

  it("returns Early Clock-Out warning when 7 minutes early", () => {
    const w = getPunchWarning("clock_out", 953, schedule, undefined, ALL_ON);
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

describe("getPunchWarning — follows the org's punch policy", () => {
  it("uses the default policy: late clock-ins and early clock-outs only", () => {
    expect(getPunchWarning("clock_in", 487, schedule)?.heading).toBe("Late Clock-In");
    expect(getPunchWarning("clock_in", 400, schedule)).toBeNull();   // early-in off by default
    expect(getPunchWarning("clock_out", 953, schedule)?.heading).toBe("Early Clock-Out");
    expect(getPunchWarning("clock_out", 1000, schedule)).toBeNull(); // late-out off by default
  });

  it("uses the org's late threshold instead of a fixed one", () => {
    const policy = { ...DEFAULT_PUNCH_POLICY, lateInMinutes: 15 };
    expect(getPunchWarning("clock_in", 492, schedule, undefined, policy)).toBeNull(); // 12 min late
    expect(getPunchWarning("clock_in", 496, schedule, undefined, policy)?.diffMinutes).toBe(16);
  });

  it("never warns about a rule the org has turned off", () => {
    const policy = { ...DEFAULT_PUNCH_POLICY, lateInEnabled: false, earlyOutEnabled: false };
    expect(getPunchWarning("clock_in", 600, schedule, undefined, policy)).toBeNull();
    expect(getPunchWarning("clock_out", 800, schedule, undefined, policy)).toBeNull();
  });
});
