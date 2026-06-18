import { describe, it, expect } from "vitest";
import {
  ageOn,
  isMinor,
  minorShiftViolations,
  DEFAULT_MINOR_RULES,
} from "./minor-rules";

describe("ageOn", () => {
  it("computes full years when the birthday has passed this year", () => {
    expect(ageOn("2008-01-10", "2026-06-17")).toBe(18);
  });
  it("subtracts a year when the birthday hasn't occurred yet", () => {
    expect(ageOn("2008-12-25", "2026-06-17")).toBe(17);
  });
  it("counts the birthday itself as the new age", () => {
    expect(ageOn("2008-06-17", "2026-06-17")).toBe(18);
  });
});

describe("isMinor", () => {
  it("is true under 18 and false at exactly 18", () => {
    expect(isMinor("2009-06-17", "2026-06-17")).toBe(true);  // 17
    expect(isMinor("2008-06-17", "2026-06-17")).toBe(false); // 18
  });
  it("honors a custom adult age", () => {
    expect(isMinor("2006-06-17", "2026-06-17", 21)).toBe(true);  // 20 < 21
    expect(isMinor("2005-06-17", "2026-06-17", 21)).toBe(false); // 21
  });
});

describe("minorShiftViolations", () => {
  it("flags a shift that ends after the latest allowed time", () => {
    // Default latest end is 22:00 (1320).
    const v = minorShiftViolations({ startMinutes: 960, endMinutes: 1380 }, DEFAULT_MINOR_RULES);
    expect(v.some((m) => /after/i.test(m))).toBe(true);
  });

  it("flags a shift longer than the daily max", () => {
    // Default daily max is 8h (480).
    const v = minorShiftViolations({ startMinutes: 480, endMinutes: 1020 }); // 9h
    expect(v.some((m) => /exceeds/i.test(m))).toBe(true);
  });

  it("returns no violations for a compliant shift", () => {
    expect(minorShiftViolations({ startMinutes: 600, endMinutes: 960 })).toEqual([]); // 6h, ends 16:00
  });

  it("can flag both rules at once", () => {
    const v = minorShiftViolations({ startMinutes: 780, endMinutes: 1380 }); // 10h, ends 23:00
    expect(v).toHaveLength(2);
  });

  it("exposes sane defaults", () => {
    expect(DEFAULT_MINOR_RULES.latestEndMinute).toBe(1320);
    expect(DEFAULT_MINOR_RULES.maxDailyMinutes).toBe(480);
  });
});
