import { describe, it, expect } from "vitest";
import {
  weekDates,
  dayOfWeek,
  shiftHours,
  scheduledHoursForDate,
  headcountAt,
  type ShiftSpan,
} from "./draft-metrics";

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

