import { describe, it, expect } from "vitest";
import {
  formatDisplayName,
  getMonogram,
  getShiftType,
  isHere,
  fmtMinutes,
  getDayCoverageStatus,
} from "./types";
import type { Schedule } from "./types";

describe("formatDisplayName", () => {
  it("returns first name and last initial for a two-word name", () => {
    expect(formatDisplayName("Alice Smith")).toBe("Alice S.");
  });

  it("uses the last word as the last name for multi-word names", () => {
    expect(formatDisplayName("Mary Jane Watson")).toBe("Mary W.");
  });

  it("returns the full name when only one word is given", () => {
    expect(formatDisplayName("Prince")).toBe("Prince");
  });

  it("trims leading and trailing whitespace", () => {
    expect(formatDisplayName("  Bob Jones  ")).toBe("Bob J.");
  });

  it("always uppercases the last initial regardless of input casing", () => {
    expect(formatDisplayName("alice smith")).toBe("alice S.");
  });
});

describe("getMonogram", () => {
  it("returns first and last initial for a two-word name", () => {
    expect(getMonogram("Alice Smith")).toBe("AS");
  });

  it("returns first and last initial for a three-word name", () => {
    expect(getMonogram("Mary Jane Watson")).toBe("MW");
  });

  it("returns a single initial for a one-word name", () => {
    expect(getMonogram("Prince")).toBe("P");
  });

  it("uppercases initials", () => {
    expect(getMonogram("alice smith")).toBe("AS");
  });

  it("handles extra whitespace between words", () => {
    expect(getMonogram("alice  smith")).toBe("AS");
  });
});

// Default store hours used across tests: 6am open, 10pm close
const OPEN = 360;
const CLOSE = 1320;

describe("getShiftType", () => {
  it("returns null for negative startMinutes (off)", () => {
    expect(getShiftType(-1, -1, OPEN, CLOSE)).toBeNull();
  });

  it("returns opener when clock-in is within 1hr of store open (open + 60 = 420)", () => {
    expect(getShiftType(0, 960, OPEN, CLOSE)).toBe("opener");   // midnight
    expect(getShiftType(360, 960, OPEN, CLOSE)).toBe("opener"); // at open
    expect(getShiftType(420, 960, OPEN, CLOSE)).toBe("opener"); // open + 60
  });

  it("does not return opener for clock-in more than 1hr after store open", () => {
    expect(getShiftType(421, 960, OPEN, CLOSE)).toBe("mid"); // open + 61
    expect(getShiftType(480, 960, OPEN, CLOSE)).toBe("mid"); // 8am
  });

  it("returns closer when clock-out is within 1hr of store close (close - 60 = 1260)", () => {
    expect(getShiftType(720, 1260, OPEN, CLOSE)).toBe("closer"); // noon in, close - 60
    expect(getShiftType(480, 1320, OPEN, CLOSE)).toBe("closer"); // 8am in, at close
  });

  it("opener takes precedence over closer", () => {
    expect(getShiftType(360, 1320, OPEN, CLOSE)).toBe("opener"); // 6am in, 10pm out
  });

  it("returns mid for everything else", () => {
    expect(getShiftType(480, 960, OPEN, CLOSE)).toBe("mid");  // 8am–4pm
    expect(getShiftType(540, 1080, OPEN, CLOSE)).toBe("mid"); // 9am–6pm
    expect(getShiftType(720, 1259, OPEN, CLOSE)).toBe("mid"); // noon–8:59pm
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

  it("handles end-of-day 1440 minutes as 12:00 AM", () => {
    expect(fmtMinutes(1440)).toBe("12:00 AM");
  });
});

describe("getDayCoverageStatus", () => {
  const weekdayHours = { open: 360, close: 1320 }; // 6am–10pm
  const makeSchedule = (start: number, end: number, id = 1): Schedule => ({
    id,
    employeeId: id,
    date: "2026-05-23",
    startMinutes: start,
    endMinutes: end,
  });

  it("returns critical when there are no schedules", () => {
    expect(getDayCoverageStatus([], weekdayHours)).toBe("critical");
  });

  it("returns optimal when >= 3 staff cover the full day", () => {
    const schedules = [
      makeSchedule(360, 1320, 1),
      makeSchedule(360, 1320, 2),
      makeSchedule(360, 1320, 3),
    ];
    expect(getDayCoverageStatus(schedules, weekdayHours)).toBe("optimal");
  });

  it("returns low when min coverage is 2 (below optimal)", () => {
    const schedules = [
      makeSchedule(360, 1320, 1),
      makeSchedule(360, 1320, 2),
    ];
    expect(getDayCoverageStatus(schedules, weekdayHours)).toBe("low");
  });

  it("returns critical when min coverage drops to 1", () => {
    const schedules = [makeSchedule(360, 1320, 1)];
    expect(getDayCoverageStatus(schedules, weekdayHours)).toBe("critical");
  });

  it("returns critical when coverage drops to zero at a shift handoff", () => {
    const schedules = [
      makeSchedule(360, 840, 1),  // 6am–2pm
      makeSchedule(840, 1320, 2), // 2pm–10pm
    ];
    expect(getDayCoverageStatus(schedules, weekdayHours)).toBe("critical");
  });

  it("respects custom store hours (Sunday)", () => {
    const sundayHours = { open: 480, close: 1200 }; // 8am–8pm
    const schedules = [
      makeSchedule(480, 1200, 1),
      makeSchedule(480, 1200, 2),
      makeSchedule(480, 1200, 3),
    ];
    expect(getDayCoverageStatus(schedules, sundayHours)).toBe("optimal");
  });
});
