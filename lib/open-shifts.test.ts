import { describe, it, expect } from "vitest";
import {
  validateOpenShift,
  overlaps,
  isEmployeeEligible,
  MIN_SHIFT_MINUTES,
  MAX_SHIFT_MINUTES,
} from "./open-shifts";

describe("validateOpenShift", () => {
  const valid = { date: "2026-06-17", startMinutes: 480, endMinutes: 960 };

  it("accepts a well-formed shift", () => {
    expect(validateOpenShift(valid)).toEqual({ valid: true });
  });

  it("rejects a malformed date", () => {
    const res = validateOpenShift({ ...valid, date: "06/17/2026" });
    expect(res.valid).toBe(false);
  });

  it("rejects empty date", () => {
    expect(validateOpenShift({ ...valid, date: "" }).valid).toBe(false);
  });

  it("rejects non-integer minutes", () => {
    expect(validateOpenShift({ ...valid, startMinutes: 480.5 }).valid).toBe(false);
  });

  it("rejects minutes below 0 or above 1440", () => {
    expect(validateOpenShift({ ...valid, startMinutes: -1 }).valid).toBe(false);
    expect(validateOpenShift({ ...valid, endMinutes: 1500 }).valid).toBe(false);
  });

  it("rejects start >= end", () => {
    expect(validateOpenShift({ ...valid, startMinutes: 960, endMinutes: 960 }).valid).toBe(false);
    expect(validateOpenShift({ ...valid, startMinutes: 961, endMinutes: 960 }).valid).toBe(false);
  });

  it("rejects shifts shorter than the minimum", () => {
    expect(
      validateOpenShift({ ...valid, startMinutes: 480, endMinutes: 480 + MIN_SHIFT_MINUTES - 1 }).valid
    ).toBe(false);
  });

  it("accepts a shift exactly at the minimum duration", () => {
    expect(
      validateOpenShift({ ...valid, startMinutes: 480, endMinutes: 480 + MIN_SHIFT_MINUTES }).valid
    ).toBe(true);
  });

  it("rejects shifts longer than the maximum", () => {
    expect(
      validateOpenShift({ date: "2026-06-17", startMinutes: 0, endMinutes: MAX_SHIFT_MINUTES + 1 }).valid
    ).toBe(false);
  });
});

describe("overlaps", () => {
  it("detects overlapping intervals", () => {
    expect(overlaps(480, 720, 600, 900)).toBe(true);
  });

  it("treats touching endpoints as non-overlapping", () => {
    expect(overlaps(480, 720, 720, 900)).toBe(false);
    expect(overlaps(720, 900, 480, 720)).toBe(false);
  });

  it("detects full containment", () => {
    expect(overlaps(480, 960, 600, 700)).toBe(true);
  });

  it("returns false for disjoint intervals", () => {
    expect(overlaps(480, 600, 700, 900)).toBe(false);
  });
});

describe("isEmployeeEligible", () => {
  const shift = { date: "2026-06-17", startMinutes: 480, endMinutes: 960 };
  const empty = { schedules: [], timeOff: [], callouts: [] };

  it("is eligible with a clear calendar", () => {
    expect(isEmployeeEligible(shift, empty)).toEqual({ eligible: true });
  });

  it("is ineligible when called out that day", () => {
    const res = isEmployeeEligible(shift, { ...empty, callouts: [{ date: "2026-06-17" }] });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/called out/i);
  });

  it("ignores call-outs on other days", () => {
    expect(
      isEmployeeEligible(shift, { ...empty, callouts: [{ date: "2026-06-18" }] }).eligible
    ).toBe(true);
  });

  it("is ineligible when on approved time off that day", () => {
    const res = isEmployeeEligible(shift, {
      ...empty,
      timeOff: [{ date: "2026-06-17", status: "approved" }],
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/time off/i);
  });

  it("ignores pending or denied time off", () => {
    expect(
      isEmployeeEligible(shift, { ...empty, timeOff: [{ date: "2026-06-17", status: "pending" }] }).eligible
    ).toBe(true);
    expect(
      isEmployeeEligible(shift, { ...empty, timeOff: [{ date: "2026-06-17", status: "denied" }] }).eligible
    ).toBe(true);
  });

  it("is ineligible when already scheduled for an overlapping shift", () => {
    const res = isEmployeeEligible(shift, {
      ...empty,
      schedules: [{ date: "2026-06-17", startMinutes: 600, endMinutes: 1020 }],
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/scheduled/i);
  });

  it("is eligible when an existing shift is on the same day but does not overlap", () => {
    expect(
      isEmployeeEligible(shift, {
        ...empty,
        schedules: [{ date: "2026-06-17", startMinutes: 960, endMinutes: 1200 }],
      }).eligible
    ).toBe(true);
  });

  it("ignores schedules on other days", () => {
    expect(
      isEmployeeEligible(shift, {
        ...empty,
        schedules: [{ date: "2026-06-18", startMinutes: 480, endMinutes: 960 }],
      }).eligible
    ).toBe(true);
  });
});
