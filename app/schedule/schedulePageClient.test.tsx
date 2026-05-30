import { describe, it, expect } from "vitest";
import { formatNextShiftDate, getDaysUntil, isShiftUpcoming } from "./schedulePageClient";

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

describe("isShiftUpcoming", () => {
  const todayKey = "2026-06-01";

  it("does NOT show a shift on today where endMinutes has already passed", () => {
    // Shift ran 06:00–14:00 (startMinutes=360, endMinutes=840); now it is 15:00 (nowMinutes=900)
    const shift = { date: todayKey, startMinutes: 360, endMinutes: 840 };
    expect(isShiftUpcoming(shift, todayKey, 900)).toBe(false);
  });

  it("DOES show a shift on today where endMinutes is in the future", () => {
    // Shift runs 14:00–22:00 (startMinutes=840, endMinutes=1320); now it is 10:00 (nowMinutes=600)
    const shift = { date: todayKey, startMinutes: 840, endMinutes: 1320 };
    expect(isShiftUpcoming(shift, todayKey, 600)).toBe(true);
  });

  it("DOES show a shift on a future date regardless of nowMinutes", () => {
    const shift = { date: "2026-06-02", startMinutes: 360, endMinutes: 840 };
    expect(isShiftUpcoming(shift, todayKey, 900)).toBe(true);
  });

  it("does NOT show a shift on a past date", () => {
    const shift = { date: "2026-05-31", startMinutes: 360, endMinutes: 840 };
    expect(isShiftUpcoming(shift, todayKey, 600)).toBe(false);
  });
});
