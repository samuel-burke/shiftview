import { describe, it, expect } from "vitest";
import {
  getShiftType,
  isHere,
  fmtMinutes,
  getDayCoverageStatus,
} from "./types";
import type { Schedule } from "./types";

describe("getShiftType", () => {
  it("returns null for negative startMinutes (off)", () => {
    expect(getShiftType(-1, -1)).toBeNull();
  });

  it("returns opener for clock-in at or before 7am (<= 420)", () => {
    expect(getShiftType(0, 960)).toBe("opener");   // midnight
    expect(getShiftType(360, 960)).toBe("opener"); // 6:00am
    expect(getShiftType(420, 960)).toBe("opener"); // 7:00am
  });

  it("does not return opener for clock-in after 7am", () => {
    expect(getShiftType(421, 960)).toBe("mid"); // 7:01am
    expect(getShiftType(480, 960)).toBe("mid"); // 8am
  });

  it("returns closer for clock-out at 9pm or later (>= 1260)", () => {
    expect(getShiftType(720, 1260)).toBe("closer"); // noon in, 9pm out
    expect(getShiftType(480, 1320)).toBe("closer"); // 8am in, 10pm out
  });

  it("opener takes precedence over closer", () => {
    expect(getShiftType(360, 1320)).toBe("opener"); // 6am in, 10pm out
  });

  it("returns mid for everything else", () => {
    expect(getShiftType(480, 960)).toBe("mid");  // 8am–4pm
    expect(getShiftType(540, 1080)).toBe("mid"); // 9am–6pm
    expect(getShiftType(720, 1259)).toBe("mid"); // noon–8:59pm
  });
});

describe("isHere", () => {
  const sch: Schedule = { id: 1, employeeId: 1, date: "2026-05-23", startMinutes: 480, endMinutes: 960 };

  it("returns true when nowMinutes is within the shift", () => {
    expect(isHere(sch, 480)).toBe(true);
    expect(isHere(sch, 720)).toBe(true);
    expect(isHere(sch, 959)).toBe(true);
  });

  it("returns false when nowMinutes is before the shift", () => {
    expect(isHere(sch, 479)).toBe(false);
  });

  it("returns false at the exact end minute (exclusive end)", () => {
    expect(isHere(sch, 960)).toBe(false);
  });

});

describe("fmtMinutes", () => {
  it("returns empty string for negative minutes", () => {
    expect(fmtMinutes(-1)).toBe("");
  });

  it("formats whole hours correctly", () => {
    expect(fmtMinutes(480)).toBe("8:00 AM");
    expect(fmtMinutes(720)).toBe("12:00 PM");
    expect(fmtMinutes(780)).toBe("1:00 PM");
  });

  it("formats minutes with padding", () => {
    expect(fmtMinutes(495)).toBe("8:15 AM");
    expect(fmtMinutes(750)).toBe("12:30 PM");
  });

  it("handles midnight edge (0 minutes)", () => {
    expect(fmtMinutes(0)).toBe("12:00 AM");
  });
});

describe("getDayCoverageStatus", () => {
  const makeSchedule = (start: number, end: number, id = 1): Schedule => ({
    id,
    employeeId: id,
    date: "2026-05-23",
    startMinutes: start,
    endMinutes: end,
  });

  it("returns critical when there are no schedules", () => {
    const monday = new Date("2026-05-25"); // Monday
    expect(getDayCoverageStatus([], monday)).toBe("critical");
  });

  it("returns optimal when >= 3 staff cover the full day", () => {
    const monday = new Date("2026-05-25");
    const schedules = [
      makeSchedule(360, 1320, 1),
      makeSchedule(360, 1320, 2),
      makeSchedule(360, 1320, 3),
    ];
    expect(getDayCoverageStatus(schedules, monday)).toBe("optimal");
  });

  it("returns low when min coverage is 2 (below optimal)", () => {
    const monday = new Date("2026-05-25");
    const schedules = [
      makeSchedule(360, 1320, 1),
      makeSchedule(360, 1320, 2),
    ];
    expect(getDayCoverageStatus(schedules, monday)).toBe("low");
  });

  it("returns critical when min coverage drops to 1", () => {
    const monday = new Date("2026-05-25");
    // Only one person for the whole day
    const schedules = [makeSchedule(360, 1320, 1)];
    expect(getDayCoverageStatus(schedules, monday)).toBe("critical");
  });

});
