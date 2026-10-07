import { describe, it, expect } from "vitest";
import { isRequestExpired } from "./request-expiry";

const TODAY = "2026-12-31";

describe("isRequestExpired", () => {
  it("expires requests for today and earlier days", () => {
    for (const date of [TODAY, "2026-12-30", "2026-01-01", "2025-12-31"]) {
      expect(isRequestExpired(date, TODAY)).toBe(true);
    }
  });

  it("keeps requests for later days (across a year boundary)", () => {
    for (const date of ["2027-01-01", "2027-01-02", "2027-06-01"]) {
      expect(isRequestExpired(date, TODAY)).toBe(false);
    }
  });

  it("compares only the calendar day of a timestamp-shaped date", () => {
    expect(isRequestExpired("2026-12-31T23:00:00", TODAY)).toBe(true);
    expect(isRequestExpired("2027-01-01T00:00:00", TODAY)).toBe(false);
  });
});
