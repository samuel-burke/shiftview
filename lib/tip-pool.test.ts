import { describe, it, expect } from "vitest";
import { allocateTips, formatCents } from "./tip-pool";

describe("allocateTips", () => {
  it("splits evenly when weights are equal", () => {
    const out = allocateTips(10000, [
      { employeeId: 1, weightMinutes: 480 },
      { employeeId: 2, weightMinutes: 480 },
    ]);
    expect(out).toEqual([
      { employeeId: 1, cents: 5000 },
      { employeeId: 2, cents: 5000 },
    ]);
  });

  it("weights by hours", () => {
    // 6h vs 2h → 3:1 of $80.00
    const out = allocateTips(8000, [
      { employeeId: 1, weightMinutes: 360 },
      { employeeId: 2, weightMinutes: 120 },
    ]);
    expect(out.find((o) => o.employeeId === 1)!.cents).toBe(6000);
    expect(out.find((o) => o.employeeId === 2)!.cents).toBe(2000);
  });

  it("distributes leftover cents by largest remainder so the sum is exact", () => {
    // $1.00 across 3 equal → 33.33.. each; remainder 1 cent.
    const out = allocateTips(100, [
      { employeeId: 1, weightMinutes: 60 },
      { employeeId: 2, weightMinutes: 60 },
      { employeeId: 3, weightMinutes: 60 },
    ]);
    expect(out.reduce((s, o) => s + o.cents, 0)).toBe(100);
    expect(out.map((o) => o.cents).sort()).toEqual([33, 33, 34]);
  });

  it("preserves participant order in the output", () => {
    const out = allocateTips(100, [
      { employeeId: 3, weightMinutes: 60 },
      { employeeId: 1, weightMinutes: 60 },
    ]);
    expect(out.map((o) => o.employeeId)).toEqual([3, 1]);
  });

  it("gives everyone zero when total weight is zero", () => {
    const out = allocateTips(500, [
      { employeeId: 1, weightMinutes: 0 },
      { employeeId: 2, weightMinutes: 0 },
    ]);
    expect(out).toEqual([
      { employeeId: 1, cents: 0 },
      { employeeId: 2, cents: 0 },
    ]);
  });

  it("returns an empty array with no participants", () => {
    expect(allocateTips(500, [])).toEqual([]);
  });
});

describe("formatCents", () => {
  it("formats cents as USD", () => {
    expect(formatCents(6000)).toBe("$60.00");
    expect(formatCents(33)).toBe("$0.33");
  });
});
