import { describe, it, expect } from "vitest";
import { validatePositionName, POSITION_NAME_MAX, countByPosition } from "./positions";

describe("validatePositionName", () => {
  it("accepts and trims a normal name", () => {
    expect(validatePositionName("  Cashier ")).toEqual({ valid: true, value: "Cashier" });
  });

  it("rejects an empty or whitespace name", () => {
    expect(validatePositionName("").valid).toBe(false);
    expect(validatePositionName("   ").valid).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(validatePositionName(42 as unknown).valid).toBe(false);
  });

  it("rejects a name over the max length", () => {
    expect(validatePositionName("x".repeat(POSITION_NAME_MAX + 1)).valid).toBe(false);
  });

  it("accepts a name exactly at the max length", () => {
    expect(validatePositionName("x".repeat(POSITION_NAME_MAX)).valid).toBe(true);
  });
});

describe("countByPosition", () => {
  it("counts shifts per assigned position and tallies the unassigned", () => {
    const result = countByPosition([
      { positionId: 1 },
      { positionId: 1 },
      { positionId: 2 },
      { positionId: null },
      {},
    ]);
    expect(result.counts).toEqual({ 1: 2, 2: 1 });
    expect(result.unassigned).toBe(2);
  });

  it("handles an empty list", () => {
    expect(countByPosition([])).toEqual({ counts: {}, unassigned: 0 });
  });
});
