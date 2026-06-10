import { describe, it, expect } from "vitest";
import {
  weekDates,
  dayOfWeek,
  shiftHours,
  scheduledHoursForDate,
  headcountAt,
  recommendedHoursForDay,
  coverageScore,
  findUnderstaffedRanges,
  type ShiftSpan,
} from "./draft-metrics";
import type { StoreHours } from "@/data/types";

// ── weekDates ─────────────────────────────────────────────────────────────────

describe("weekDates", () => {
  it("returns 7 dates starting from weekStart", () => {
    const dates = weekDates("2026-06-01");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-06-01");
    expect(dates[6]).toBe("2026-06-07");
  });

  it("returns consecutive dates in order", () => {
    const dates = weekDates("2026-05-26");
    for (let i = 1; i < 7; i++) {
      const prev = new Date(dates[i - 1] + "T12:00:00Z");
      const curr = new Date(dates[i] + "T12:00:00Z");
      expect(curr.getTime() - prev.getTime()).toBe(86400000); // 24h in ms
    }
  });

  it("formats dates as YYYY-MM-DD", () => {
    const dates = weekDates("2026-01-05");
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("handles month boundaries correctly", () => {
    const dates = weekDates("2026-01-29");
    expect(dates[0]).toBe("2026-01-29");
    expect(dates[2]).toBe("2026-01-31");
    expect(dates[3]).toBe("2026-02-01");
    expect(dates[6]).toBe("2026-02-04");
  });

  it("handles year boundaries correctly", () => {
    const dates = weekDates("2025-12-29");
    expect(dates[0]).toBe("2025-12-29");
    expect(dates[3]).toBe("2026-01-01");
  });
});

// ── dayOfWeek ─────────────────────────────────────────────────────────────────

describe("dayOfWeek", () => {
  it("returns 0 for Sunday", () => {
    expect(dayOfWeek("2026-06-07")).toBe(0); // Sunday
  });

  it("returns 1 for Monday", () => {
    expect(dayOfWeek("2026-06-01")).toBe(1); // Monday
  });

  it("returns 6 for Saturday", () => {
    expect(dayOfWeek("2026-06-06")).toBe(6); // Saturday
  });

  it("returns correct day for a midweek date", () => {
    expect(dayOfWeek("2026-06-03")).toBe(3); // Wednesday
  });
});

// ── shiftHours ────────────────────────────────────────────────────────────────

describe("shiftHours", () => {
  it("returns 8 for an 8-hour shift (480–960)", () => {
    expect(shiftHours({ startMinutes: 480, endMinutes: 960 })).toBe(8);
  });

  it("returns 0.5 for a 30-minute span", () => {
    expect(shiftHours({ startMinutes: 0, endMinutes: 30 })).toBe(0.5);
  });

  it("returns correct fractional hours", () => {
    expect(shiftHours({ startMinutes: 540, endMinutes: 810 })).toBe(4.5);
  });

  it("returns 0 when start equals end (degenerate)", () => {
    expect(shiftHours({ startMinutes: 480, endMinutes: 480 })).toBe(0);
  });
});

// ── scheduledHoursForDate ─────────────────────────────────────────────────────

describe("scheduledHoursForDate", () => {
  const shifts: ShiftSpan[] = [
    { date: "2026-06-01", startMinutes: 480, endMinutes: 960 }, // 8h
    { date: "2026-06-01", startMinutes: 960, endMinutes: 1200 }, // 4h
    { date: "2026-06-02", startMinutes: 360, endMinutes: 840 }, // 8h
  ];

  it("sums hours for the requested date", () => {
    expect(scheduledHoursForDate(shifts, "2026-06-01")).toBe(12);
  });

  it("returns 0 for a date with no shifts", () => {
    expect(scheduledHoursForDate(shifts, "2026-06-03")).toBe(0);
  });

  it("only counts shifts matching the date", () => {
    expect(scheduledHoursForDate(shifts, "2026-06-02")).toBe(8);
  });

  it("returns 0 for empty shifts array", () => {
    expect(scheduledHoursForDate([], "2026-06-01")).toBe(0);
  });

  it("handles date with timestamp suffix by slicing to YYYY-MM-DD", () => {
    const ts: ShiftSpan[] = [
      { date: "2026-06-01T00:00:00", startMinutes: 480, endMinutes: 960 },
    ];
    expect(scheduledHoursForDate(ts, "2026-06-01")).toBe(8);
  });
});

// ── headcountAt ───────────────────────────────────────────────────────────────

describe("headcountAt", () => {
  const shifts: ShiftSpan[] = [
    { date: "2026-06-01", startMinutes: 480, endMinutes: 960 },
    { date: "2026-06-01", startMinutes: 600, endMinutes: 1080 },
    { date: "2026-06-02", startMinutes: 480, endMinutes: 960 },
  ];

  it("counts overlapping shifts at a given minute", () => {
    // Both shifts active at 600 (600 >= 480 and 600 < 960; 600 >= 600 and 600 < 1080)
    expect(headcountAt(shifts, "2026-06-01", 600)).toBe(2);
  });

  it("counts only the first shift before the second starts", () => {
    expect(headcountAt(shifts, "2026-06-01", 540)).toBe(1);
  });

  it("returns 0 before any shift starts", () => {
    expect(headcountAt(shifts, "2026-06-01", 479)).toBe(0);
  });

  it("excludes shifts at endMinutes (exclusive end)", () => {
    // Shift ends at 960, so minute 960 should not count it
    expect(headcountAt(shifts, "2026-06-01", 960)).toBe(1); // only second shift active
  });

  it("filters by date", () => {
    expect(headcountAt(shifts, "2026-06-02", 600)).toBe(1);
  });

  it("returns 0 for empty shifts array", () => {
    expect(headcountAt([], "2026-06-01", 480)).toBe(0);
  });

  it("returns 0 for a date with no shifts", () => {
    expect(headcountAt(shifts, "2026-06-03", 600)).toBe(0);
  });
});

// ── recommendedHoursForDay ────────────────────────────────────────────────────

describe("recommendedHoursForDay", () => {
  it("returns 0 for undefined hours", () => {
    expect(recommendedHoursForDay(undefined, 3)).toBe(0);
  });

  it("returns 0 when close <= open (closed day)", () => {
    expect(recommendedHoursForDay({ open: 480, close: 480 }, 3)).toBe(0);
    expect(recommendedHoursForDay({ open: 960, close: 480 }, 3)).toBe(0);
  });

  it("computes optimalCoverage * openHours for a normal day", () => {
    // open=480 (8am), close=1200 (8pm) → 720 min = 12 hours, coverage=2 → 24h
    expect(recommendedHoursForDay({ open: 480, close: 1200 }, 2)).toBe(24);
  });

  it("scales linearly with optimalCoverage", () => {
    const hours: StoreHours = { open: 480, close: 960 }; // 8h open
    expect(recommendedHoursForDay(hours, 1)).toBe(8);
    expect(recommendedHoursForDay(hours, 3)).toBe(24);
  });

  it("returns 0 for optimalCoverage=0", () => {
    expect(recommendedHoursForDay({ open: 480, close: 960 }, 0)).toBe(0);
  });
});

// ── coverageScore ─────────────────────────────────────────────────────────────

describe("coverageScore", () => {
  // Monday (dayOfWeek=1) store hours: 8am–4pm (480–960)
  const storeHours: Record<number, StoreHours> = {
    1: { open: 480, close: 960 },
  };

  it("returns null when no open slots (all days closed)", () => {
    const result = coverageScore([], ["2026-06-03"], {}, 2);
    expect(result).toBeNull();
  });

  it("returns null for empty dates array", () => {
    expect(coverageScore([], [], storeHours, 2)).toBeNull();
  });

  it("returns 0 when no shifts are scheduled", () => {
    // Monday 2026-06-01
    expect(coverageScore([], ["2026-06-01"], storeHours, 2)).toBe(0);
  });

  it("returns 100 when all slots have sufficient coverage", () => {
    // Cover all slots Mon 8am-4pm with 2 employees
    const shifts: ShiftSpan[] = [
      { date: "2026-06-01", startMinutes: 480, endMinutes: 960 },
      { date: "2026-06-01", startMinutes: 480, endMinutes: 960 },
    ];
    expect(coverageScore(shifts, ["2026-06-01"], storeHours, 2)).toBe(100);
  });

  it("returns partial percentage when some slots are covered", () => {
    // Only 1 employee for all slots, minCoverage=2 → 0% covered
    const shifts: ShiftSpan[] = [
      { date: "2026-06-01", startMinutes: 480, endMinutes: 960 },
    ];
    expect(coverageScore(shifts, ["2026-06-01"], storeHours, 1)).toBe(100);
    expect(coverageScore(shifts, ["2026-06-01"], storeHours, 2)).toBe(0);
  });

  it("skips closed days (close <= open)", () => {
    const closedHours: Record<number, StoreHours> = { 1: { open: 480, close: 480 } };
    expect(coverageScore([], ["2026-06-01"], closedHours, 2)).toBeNull();
  });

  it("rounds percentage to nearest integer", () => {
    // 8am–4pm is 16 slots of 30 min. Cover first 8 slots (one person at 480–720).
    // minCoverage=1 → 8/16 = 50%
    const shifts: ShiftSpan[] = [
      { date: "2026-06-01", startMinutes: 480, endMinutes: 720 },
    ];
    expect(coverageScore(shifts, ["2026-06-01"], storeHours, 1)).toBe(50);
  });

  it("aggregates across multiple dates", () => {
    // Two Mondays, one covered one not
    const multiHours: Record<number, StoreHours> = {
      1: { open: 480, close: 960 }, // 16 slots
    };
    const shifts: ShiftSpan[] = [
      { date: "2026-06-01", startMinutes: 480, endMinutes: 960 }, // first Monday: covered
    ];
    // "2026-06-08" is also a Monday
    const dates = ["2026-06-01", "2026-06-08"];
    const score = coverageScore(shifts, dates, multiHours, 1);
    expect(score).toBe(50); // 16/32 slots covered
  });
});

// ── findUnderstaffedRanges ────────────────────────────────────────────────────

describe("findUnderstaffedRanges", () => {
  const storeHours: Record<number, StoreHours> = {
    1: { open: 480, close: 600 }, // 8am–10am (4 slots: 480,510,540,570)
  };

  const monday = "2026-06-01"; // dayOfWeek = 1

  it("returns empty array when no open days", () => {
    expect(findUnderstaffedRanges([], [monday], {}, 2)).toEqual([]);
  });

  it("returns empty array when closed day (close <= open)", () => {
    const closedHours: Record<number, StoreHours> = {
      1: { open: 600, close: 480 },
    };
    expect(findUnderstaffedRanges([], [monday], closedHours, 2)).toEqual([]);
  });

  it("returns one range covering the full open window when no shifts scheduled", () => {
    const alerts = findUnderstaffedRanges([], [monday], storeHours, 1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      date: monday,
      startMinutes: 480,
      endMinutes: 600,
      shortfall: 1,
    });
  });

  it("range extends to close when understaffing lasts until end of day", () => {
    const alerts = findUnderstaffedRanges([], [monday], storeHours, 2);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].endMinutes).toBe(600);
  });

  it("returns empty array when all slots are covered", () => {
    const shifts: ShiftSpan[] = [
      { date: monday, startMinutes: 480, endMinutes: 600 },
      { date: monday, startMinutes: 480, endMinutes: 600 },
    ];
    const alerts = findUnderstaffedRanges(shifts, [monday], storeHours, 2);
    expect(alerts).toEqual([]);
  });

  it("returns one alert with correct shortfall when 1 of 2 required", () => {
    const shifts: ShiftSpan[] = [
      { date: monday, startMinutes: 480, endMinutes: 600 },
    ];
    const alerts = findUnderstaffedRanges(shifts, [monday], storeHours, 2);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].shortfall).toBe(1); // needed 2, had 1
  });

  it("returns two separate ranges when a covered slot splits understaffing", () => {
    // Hours: 480–660 (6 slots: 480,510,540,570,600,630)
    const splitHours: Record<number, StoreHours> = {
      1: { open: 480, close: 660 },
    };
    // Shift covers 540–570 only → understaffed 480–540, 570–660
    const shifts: ShiftSpan[] = [
      { date: monday, startMinutes: 540, endMinutes: 570 },
    ];
    const alerts = findUnderstaffedRanges(shifts, [monday], splitHours, 1);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ startMinutes: 480, endMinutes: 540 });
    expect(alerts[1]).toMatchObject({ startMinutes: 570, endMinutes: 660 });
  });

  it("multiple understaffed ranges in one day — one contiguous range when all slots understaffed", () => {
    // Hours: 480–720 (8 slots: 480,510,540,570,600,630,660,690)
    // minCoverage=2; slots 480–600 have 0 staff, slots 600–720 have 1 staff
    // Both are below minCoverage=2 so it is ONE continuous understaffed range
    const hours: Record<number, StoreHours> = {
      1: { open: 480, close: 720 },
    };
    const shifts: ShiftSpan[] = [
      { date: monday, startMinutes: 600, endMinutes: 720 }, // 4 slots with 1 person
    ];
    const alerts = findUnderstaffedRanges(shifts, [monday], hours, 2);
    // All slots are < minCoverage → one merged range 480–720
    // worst slot has 0 staff → shortfall = 2
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ startMinutes: 480, endMinutes: 720, shortfall: 2 });
  });

  it("multiple understaffed ranges in one day — two ranges when a fully-covered slot splits them", () => {
    // Hours: 480–720. minCoverage=1.
    // Shift 1: 540–570 (1 person covers 1 slot)
    // Understaffed before: 480–540; after: 570–720
    const hours: Record<number, StoreHours> = {
      1: { open: 480, close: 720 },
    };
    const shifts: ShiftSpan[] = [
      { date: monday, startMinutes: 540, endMinutes: 570 },
    ];
    const alerts = findUnderstaffedRanges(shifts, [monday], hours, 1);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ startMinutes: 480, endMinutes: 540, shortfall: 1 });
    expect(alerts[1]).toMatchObject({ startMinutes: 570, endMinutes: 720, shortfall: 1 });
  });

  it("reports worst shortfall within a range (most understaffed slot)", () => {
    // Hours: 480–600 (4 slots: 480,510,540,570)
    // minCoverage=3; first 2 slots have 0 workers, last 2 have 2 workers
    // The range covers all 4 slots; worst = 0, shortfall = 3
    const shifts: ShiftSpan[] = [
      { date: monday, startMinutes: 540, endMinutes: 600 },
      { date: monday, startMinutes: 540, endMinutes: 600 },
    ];
    const alerts = findUnderstaffedRanges(shifts, [monday], storeHours, 3);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].shortfall).toBe(3); // worst slot (480–540) had 0, needed 3
  });

  it("works across multiple dates", () => {
    const twoHours: Record<number, StoreHours> = {
      1: { open: 480, close: 600 },
    };
    // Both Mondays understaffed
    const alerts = findUnderstaffedRanges([], ["2026-06-01", "2026-06-08"], twoHours, 1);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.date)).toContain("2026-06-01");
    expect(alerts.map((a) => a.date)).toContain("2026-06-08");
  });

  it("returns empty array for empty dates array", () => {
    expect(findUnderstaffedRanges([], [], storeHours, 2)).toEqual([]);
  });
});
