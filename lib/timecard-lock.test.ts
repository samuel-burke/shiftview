import { describe, it, expect } from "vitest";
import { localDateInTz, lockForDate, periodsOverlap, type ApprovalPeriod } from "./timecard-lock";

describe("localDateInTz", () => {
  it("maps a late-evening Eastern punch to its LOCAL date, not the UTC date", () => {
    // 2026-06-01T01:53:08Z = 9:53 PM EDT on May 31.
    expect(localDateInTz("2026-06-01T01:53:08.000Z", "America/New_York")).toBe("2026-05-31");
  });

  it("maps a midday punch to the same calendar date", () => {
    expect(localDateInTz("2026-06-01T12:00:00.000Z", "America/New_York")).toBe("2026-06-01");
  });

  it("respects a different timezone (Los Angeles)", () => {
    // 2026-06-02T05:30:00Z = 10:30 PM PDT on June 1.
    expect(localDateInTz("2026-06-02T05:30:00.000Z", "America/Los_Angeles")).toBe("2026-06-01");
  });

  it("accepts a Date instance as well as an ISO string", () => {
    expect(localDateInTz(new Date("2026-06-01T12:00:00.000Z"), "America/New_York")).toBe("2026-06-01");
  });
});

describe("lockForDate", () => {
  const periods: ApprovalPeriod[] = [
    { periodStart: "2026-06-01", periodEnd: "2026-06-14" },
    { periodStart: "2026-06-15", periodEnd: "2026-06-28" },
  ];

  it("returns the covering period for a date inside the range", () => {
    expect(lockForDate("2026-06-07", periods)?.periodStart).toBe("2026-06-01");
    expect(lockForDate("2026-06-20", periods)?.periodStart).toBe("2026-06-15");
  });

  it("is inclusive of the start boundary", () => {
    expect(lockForDate("2026-06-01", periods)).not.toBeNull();
  });

  it("is inclusive of the end boundary", () => {
    expect(lockForDate("2026-06-14", periods)?.periodEnd).toBe("2026-06-14");
  });

  it("returns null for a date before any period", () => {
    expect(lockForDate("2026-05-31", periods)).toBeNull();
  });

  it("returns null for a date after every period", () => {
    expect(lockForDate("2026-06-29", periods)).toBeNull();
  });

  it("returns null when there are no periods", () => {
    expect(lockForDate("2026-06-07", [])).toBeNull();
  });
});

describe("periodsOverlap", () => {
  it("detects a fully contained range", () => {
    expect(periodsOverlap("2026-06-05", "2026-06-08", "2026-06-01", "2026-06-14")).toBe(true);
  });

  it("detects identical ranges", () => {
    expect(periodsOverlap("2026-06-01", "2026-06-14", "2026-06-01", "2026-06-14")).toBe(true);
  });

  it("treats touching ranges (shared boundary day) as overlapping", () => {
    expect(periodsOverlap("2026-06-14", "2026-06-20", "2026-06-01", "2026-06-14")).toBe(true);
  });

  it("returns false for cleanly separated ranges", () => {
    expect(periodsOverlap("2026-06-15", "2026-06-28", "2026-06-01", "2026-06-14")).toBe(false);
  });
});
