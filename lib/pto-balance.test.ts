import { describe, it, expect } from "vitest";
import { approvedDaysUsed, computePtoBalance } from "./pto-balance";

describe("approvedDaysUsed", () => {
  it("counts approved dates within the year", () => {
    expect(approvedDaysUsed(["2026-01-05", "2026-07-04", "2025-12-31"], 2026)).toBe(2);
  });

  it("dedupes repeated dates", () => {
    expect(approvedDaysUsed(["2026-01-05", "2026-01-05"], 2026)).toBe(1);
  });

  it("is zero when no dates fall in the year", () => {
    expect(approvedDaysUsed(["2025-01-05"], 2026)).toBe(0);
  });

  it("tolerates timestamp-style date prefixes", () => {
    expect(approvedDaysUsed(["2026-03-01T00:00:00Z"], 2026)).toBe(1);
  });
});

describe("computePtoBalance", () => {
  it("computes remaining from allowance minus used", () => {
    const b = computePtoBalance(15, ["2026-01-05", "2026-07-04"], 2026);
    expect(b).toEqual({ tracked: true, allowanceDays: 15, usedDays: 2, remainingDays: 13 });
  });

  it("reports untracked when no allowance is set", () => {
    const b = computePtoBalance(null, ["2026-01-05"], 2026);
    expect(b.tracked).toBe(false);
    expect(b.allowanceDays).toBeNull();
    expect(b.remainingDays).toBeNull();
    // Usage is still counted so a UI can show days taken even when untracked.
    expect(b.usedDays).toBe(1);
  });

  it("allows a negative remaining when the allowance is exceeded", () => {
    const b = computePtoBalance(2, ["2026-01-01", "2026-01-02", "2026-01-03"], 2026);
    expect(b.usedDays).toBe(3);
    expect(b.remainingDays).toBe(-1);
  });

  it("only counts the requested year", () => {
    const b = computePtoBalance(10, ["2025-12-31", "2026-01-01"], 2026);
    expect(b.usedDays).toBe(1);
    expect(b.remainingDays).toBe(9);
  });
});
