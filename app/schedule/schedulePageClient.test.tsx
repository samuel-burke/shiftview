import { describe, it, expect } from "vitest";
import { formatNextShiftDate, getDaysUntil } from "./schedulePageClient";

describe("formatNextShiftDate", () => {
  it('returns "Today" for the same date', () => {
    expect(formatNextShiftDate("2026-06-01", "2026-06-01")).toBe("Today");
  });

  it('returns "Tomorrow" for the next day', () => {
    expect(formatNextShiftDate("2026-06-02", "2026-06-01")).toBe("Tomorrow");
  });

  it("returns formatted date for other dates", () => {
    const result = formatNextShiftDate("2026-06-05", "2026-06-01");
    expect(result).toContain("Friday");
    expect(result).toContain("5");
  });
});

describe("getDaysUntil", () => {
  it("returns 0 for today", () => {
    expect(getDaysUntil("2026-06-01", "2026-06-01")).toBe(0);
  });

  it("returns 1 for tomorrow", () => {
    expect(getDaysUntil("2026-06-02", "2026-06-01")).toBe(1);
  });

  it("returns correct count for future dates", () => {
    expect(getDaysUntil("2026-06-08", "2026-06-01")).toBe(7);
  });
});
