import { describe, it, expect } from "vitest";
import { DENOMINATIONS, countTotal, tillVariance, validateTillCount } from "./till";

describe("countTotal", () => {
  it("sums denominations to cents", () => {
    // 2×$20 + 3×$5 + 4×25¢ = 4000 + 1500 + 100 = 5600
    expect(countTotal({ twenty: 2, five: 3, quarter: 4 })).toBe(5600);
  });
  it("treats missing denominations as zero", () => {
    expect(countTotal({})).toBe(0);
  });
  it("ignores unknown keys", () => {
    expect(countTotal({ doubloon: 5, one: 2 } as any)).toBe(200);
  });
  it("covers the standard US denominations", () => {
    expect(DENOMINATIONS.hundred).toBe(10000);
    expect(DENOMINATIONS.penny).toBe(1);
  });
});

describe("tillVariance", () => {
  it("is balanced when counted equals expected", () => {
    expect(tillVariance(20000, 20000)).toEqual({ varianceCents: 0, status: "balanced" });
  });
  it("is over when counted exceeds expected", () => {
    expect(tillVariance(20000, 20500)).toEqual({ varianceCents: 500, status: "over" });
  });
  it("is short when counted is below expected", () => {
    expect(tillVariance(20000, 19000)).toEqual({ varianceCents: -1000, status: "short" });
  });
});

describe("validateTillCount", () => {
  it("accepts non-negative integer cents and a valid type", () => {
    expect(validateTillCount({ type: "close", expectedCents: 20000, countedCents: 19950 }).valid).toBe(true);
  });
  it("rejects an unknown type", () => {
    expect(validateTillCount({ type: "midday", expectedCents: 0, countedCents: 0 }).valid).toBe(false);
  });
  it("rejects negative or non-integer cents", () => {
    expect(validateTillCount({ type: "open", expectedCents: -1, countedCents: 0 }).valid).toBe(false);
    expect(validateTillCount({ type: "open", expectedCents: 1.5, countedCents: 0 }).valid).toBe(false);
  });
});
