import { describe, it, expect } from "vitest";
import { salesPerLaborHour, validateSalesAmount, formatCentsPerHour } from "./splh";

describe("salesPerLaborHour", () => {
  it("returns cents of sales per labor hour", () => {
    // $1000 over 40 labor hours = $25/hr → 2500 cents.
    expect(salesPerLaborHour(100000, 2400)).toBe(2500);
  });
  it("rounds to whole cents", () => {
    // $100 over 3 hours = $33.33/hr.
    expect(salesPerLaborHour(10000, 180)).toBe(3333);
  });
  it("is null when there are no labor hours", () => {
    expect(salesPerLaborHour(10000, 0)).toBeNull();
  });
  it("is null for negative labor", () => {
    expect(salesPerLaborHour(10000, -10)).toBeNull();
  });
});

describe("validateSalesAmount", () => {
  it("accepts a non-negative integer cents", () => {
    expect(validateSalesAmount(50000).valid).toBe(true);
    expect(validateSalesAmount(0).valid).toBe(true);
  });
  it("rejects negative or non-integer", () => {
    expect(validateSalesAmount(-1).valid).toBe(false);
    expect(validateSalesAmount(10.5).valid).toBe(false);
    expect(validateSalesAmount("100" as unknown).valid).toBe(false);
  });
});

describe("formatCentsPerHour", () => {
  it("formats as $/hr", () => {
    expect(formatCentsPerHour(2500)).toBe("$25.00/hr");
  });
  it("formats null as a dash", () => {
    expect(formatCentsPerHour(null)).toBe("—");
  });
});
