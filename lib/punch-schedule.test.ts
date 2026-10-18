import { describe, it, expect } from "vitest";
import { isClockInShift, pickClockInShift } from "./punch-schedule";

const tz = "America/New_York";
const at = (iso: string) => Date.parse(iso);

describe("isClockInShift", () => {
  // Oct 14, 10 PM – Oct 15, 6 AM (EDT, UTC−4).
  const overnight = { date: "2026-10-14", end_minutes: 1800 };

  it("accepts yesterday's overnight shift while it runs and within the late grace", () => {
    expect(isClockInShift(overnight, tz, at("2026-10-15T07:00:00Z"))).toBe(true);  // 3 AM
    expect(isClockInShift(overnight, tz, at("2026-10-15T11:59:00Z"))).toBe(true);  // 7:59 AM
  });

  it("refuses yesterday's overnight shift once the grace after its end has passed", () => {
    expect(isClockInShift(overnight, tz, at("2026-10-15T12:00:00Z"))).toBe(false); // 8 AM
    expect(isClockInShift(overnight, tz, at("2026-10-15T18:00:00Z"))).toBe(false); // 2 PM
  });

  it("accepts today's shift even after it ended (a late clock-in), never yesterday's day shift", () => {
    expect(isClockInShift({ date: "2026-10-15", end_minutes: 720 }, tz, at("2026-10-15T20:00:00Z"))).toBe(true);
    expect(isClockInShift({ date: "2026-10-14", end_minutes: 1020 }, tz, at("2026-10-15T07:00:00Z"))).toBe(false);
  });
});

describe("pickClockInShift", () => {
  const morning   = { id: 1, employeeId: 5, date: "2026-10-15", startMinutes: 480,  endMinutes: 720 };  // 8–12
  const afternoon = { id: 2, employeeId: 5, date: "2026-10-15", startMinutes: 960,  endMinutes: 1200 }; // 4–8 PM
  const coworker  = { id: 3, employeeId: 6, date: "2026-10-15", startMinutes: 900,  endMinutes: 1200 };
  const lastNight = { id: 4, employeeId: 5, date: "2026-10-14", startMinutes: 1320, endMinutes: 1800 }; // 10 PM–6 AM
  const split = [morning, afternoon, coworker];

  it("picks the half of a split shift that is running", () => {
    expect(pickClockInShift(5, split, tz, at("2026-10-15T20:00:00Z"))?.id).toBe(2); // 4 PM
    expect(pickClockInShift(5, split, tz, at("2026-10-15T13:00:00Z"))?.id).toBe(1); // 9 AM
  });

  it("picks the next shift to start between the halves", () => {
    expect(pickClockInShift(5, split, tz, at("2026-10-15T17:00:00Z"))?.id).toBe(2); // 1 PM
    expect(pickClockInShift(5, split, tz, at("2026-10-15T11:00:00Z"))?.id).toBe(1); // 7 AM
  });

  it("falls back to the shift that ended most recently", () => {
    expect(pickClockInShift(5, split, tz, at("2026-10-16T01:00:00Z"))?.id).toBe(2); // 9 PM
  });

  it("only offers last night's shift while the server still accepts a clock-in to it", () => {
    expect(pickClockInShift(5, [lastNight], tz, at("2026-10-15T07:00:00Z"))?.id).toBe(4); // 3 AM, running
    expect(pickClockInShift(5, [lastNight], tz, at("2026-10-15T11:00:00Z"))?.id).toBe(4); // 7 AM, in grace
    expect(pickClockInShift(5, [lastNight], tz, at("2026-10-15T14:00:00Z"))).toBeNull();  // 10 AM
    expect(pickClockInShift(5, [lastNight, morning], tz, at("2026-10-15T09:00:00Z"))?.id).toBe(4); // 5 AM
  });

  it("ignores coworkers' shifts and needs an employee", () => {
    expect(pickClockInShift(6, split, tz, at("2026-10-15T20:00:00Z"))?.id).toBe(3);
    expect(pickClockInShift(null, split, tz, at("2026-10-15T20:00:00Z"))).toBeNull();
  });
});
