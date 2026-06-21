import { describe, it, expect } from "vitest";
import {
  OVERTIME_MULTIPLIER,
  computeLaborCost,
  summarizeWeeklyCost,
} from "./labor-cost";

describe("computeLaborCost", () => {
  it("splits minutes into regular and overtime at the 40h threshold", () => {
    const r = computeLaborCost({ totalMinutes: 2700, payRate: 20 }); // 45h
    expect(r.regularMinutes).toBe(2400);
    expect(r.overtimeMinutes).toBe(300);
  });

  it("costs regular hours at the rate and overtime at 1.5×", () => {
    // 45h @ $20 → 40×20 + 5×20×1.5 = 800 + 150 = 950
    const r = computeLaborCost({ totalMinutes: 2700, payRate: 20 });
    expect(r.cost).toBe(950);
  });

  it("has no overtime when at or under the threshold", () => {
    const r = computeLaborCost({ totalMinutes: 1920, payRate: 20 }); // 32h
    expect(r.overtimeMinutes).toBe(0);
    expect(r.cost).toBe(640); // 32 × 20
  });

  it("returns a null cost when the rate is unknown", () => {
    const r = computeLaborCost({ totalMinutes: 2400, payRate: null });
    expect(r.cost).toBeNull();
    expect(r.regularMinutes).toBe(2400);
  });

  it("honors custom threshold and multiplier", () => {
    const r = computeLaborCost(
      { totalMinutes: 600, payRate: 10 }, // 10h
      { threshold: 480, otMultiplier: 2 } // OT over 8h, double time
    );
    // 8h × 10 + 2h × 10 × 2 = 80 + 40 = 120
    expect(r.cost).toBe(120);
  });

  it("rounds cost to cents", () => {
    const r = computeLaborCost({ totalMinutes: 130, payRate: 15.5 }); // 2h10m
    // (130/60) × 15.5 = 33.583... → 33.58
    expect(r.cost).toBe(33.58);
  });

  it("exposes the overtime multiplier constant", () => {
    expect(OVERTIME_MULTIPLIER).toBe(1.5);
  });
});

describe("summarizeWeeklyCost", () => {
  const employees = [
    { employeeId: 1, totalMinutes: 2700, payRate: 20 }, // $950
    { employeeId: 2, totalMinutes: 1200, payRate: 15 }, // 20h × 15 = $300
    { employeeId: 3, totalMinutes: 600, payRate: null }, // unknown
  ];

  it("totals known costs and counts employees missing a rate", () => {
    const s = summarizeWeeklyCost(employees);
    expect(s.totalCost).toBe(1250);
    expect(s.employeesMissingRate).toBe(1);
  });

  it("sorts rows by cost descending with unknown rates last", () => {
    const s = summarizeWeeklyCost(employees);
    expect(s.rows.map((r) => r.employeeId)).toEqual([1, 2, 3]);
    expect(s.rows[2].cost).toBeNull();
  });

  it("does not count zero-minute employees as missing a rate", () => {
    const s = summarizeWeeklyCost([{ employeeId: 9, totalMinutes: 0, payRate: null }]);
    expect(s.employeesMissingRate).toBe(0);
  });
});
