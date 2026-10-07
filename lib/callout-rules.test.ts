import { describe, it, expect } from "vitest";
import { calloutBlockReason } from "./callout-rules";

const TODAY = "2026-12-31";
const base = { todayKey: TODAY, hasShift: true, clockedInToday: false };

describe("calloutBlockReason", () => {
  it("allows today's and tomorrow's shifts (across a year boundary)", () => {
    expect(calloutBlockReason({ ...base, date: TODAY })).toBeNull();
    expect(calloutBlockReason({ ...base, date: "2027-01-01" })).toBeNull();
  });

  it("rejects any other day", () => {
    for (const date of ["2026-12-30", "2027-01-02", "2027-06-01"]) {
      expect(calloutBlockReason({ ...base, date })).toBe("You can only call out for today's or tomorrow's shift");
    }
  });

  it("requires a scheduled shift", () => {
    expect(calloutBlockReason({ ...base, date: TODAY, hasShift: false })).toBe("You don't have a shift scheduled that day");
  });

  it("blocks today's call-out after clocking in, but not tomorrow's", () => {
    expect(calloutBlockReason({ ...base, date: TODAY, clockedInToday: true })).toBe("You've already clocked in for today's shift");
    expect(calloutBlockReason({ ...base, date: "2027-01-01", clockedInToday: true })).toBeNull();
  });
});
