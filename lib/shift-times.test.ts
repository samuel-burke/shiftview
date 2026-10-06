import { describe, it, expect } from "vitest";
import {
  isOvernight,
  isWorkingAt,
  minutesFromTimeInputs,
  shiftParts,
  shiftTouchesDay,
  shiftWindowOn,
  shiftsOverlap,
  timeInputFromMinutes,
  validateShiftTimes,
} from "./shift-times";

const night = { date: "2026-03-07", startMinutes: 1320, endMinutes: 1800 }; // Sat 10 PM – Sun 6 AM

describe("validateShiftTimes", () => {
  it("accepts a day shift and a 10 PM – 6 AM overnight shift", () => {
    expect(validateShiftTimes(540, 1020)).toBeNull();
    expect(validateShiftTimes(1320, 1800)).toBeNull();
  });

  it("rejects bad ranges", () => {
    expect(validateShiftTimes(1440, 1500)).toMatch(/between 0 and 1439/);
    expect(validateShiftTimes(600, 600)).toMatch(/less than endMinutes/);
    expect(validateShiftTimes(600, 630)).toMatch(/at least 1 hour/);
    expect(validateShiftTimes(1320, 2281)).toMatch(/16 hours/);
    expect(validateShiftTimes(1.5, 600)).toMatch(/integers/);
  });
});

describe("overnight helpers", () => {
  it("places the shift relative to each day", () => {
    expect(isOvernight(night)).toBe(true);
    expect(shiftWindowOn(night, "2026-03-07")).toEqual({ start: 1320, end: 1800 });
    expect(shiftWindowOn(night, "2026-03-08")).toEqual({ start: -120, end: 360 });
    expect(shiftTouchesDay(night, "2026-03-08")).toBe(true);
    expect(shiftTouchesDay(night, "2026-03-09")).toBe(false);
    expect(shiftTouchesDay({ date: "2026-03-07", startMinutes: 540, endMinutes: 1020 }, "2026-03-08")).toBe(false);
  });

  it("knows who's working after midnight", () => {
    expect(isWorkingAt(night, "2026-03-08", 300)).toBe(true);
    expect(isWorkingAt(night, "2026-03-08", 360)).toBe(false);
    expect(isWorkingAt(night, "2026-03-07", 1300)).toBe(false);
  });

  it("splits into per-day parts", () => {
    expect(shiftParts(night)).toEqual([
      { date: "2026-03-07", start: 1320, end: 1440 },
      { date: "2026-03-08", start: 0, end: 360 },
    ]);
    expect(shiftParts({ date: "2026-03-07", startMinutes: 540, endMinutes: 1020 })).toHaveLength(1);
  });

  it("detects overlap with the next morning's shift", () => {
    expect(shiftsOverlap(night, { date: "2026-03-08", startMinutes: 300, endMinutes: 780 })).toBe(true);
    expect(shiftsOverlap(night, { date: "2026-03-08", startMinutes: 360, endMinutes: 780 })).toBe(false);
    expect(shiftsOverlap({ date: "2026-03-08", startMinutes: 300, endMinutes: 780 }, night)).toBe(true);
  });
});

describe("time inputs", () => {
  it("treats an end at or before the start as the next day", () => {
    expect(minutesFromTimeInputs("22:00", "06:00")).toEqual({ startMinutes: 1320, endMinutes: 1800 });
    expect(minutesFromTimeInputs("09:00", "17:00")).toEqual({ startMinutes: 540, endMinutes: 1020 });
  });

  it("shows an overnight end as a clock time", () => {
    expect(timeInputFromMinutes(1800)).toBe("06:00");
    expect(timeInputFromMinutes(1320)).toBe("22:00");
  });
});
