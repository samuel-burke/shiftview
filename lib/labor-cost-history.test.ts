import { describe, it, expect } from "vitest";
import { computeLaborCost, scheduledCostByDay } from "./labor-cost";
import { makeRateLookup, RATE_BEGINNING, type PayRateRow } from "./pay-rates";

// Scheduled labor cost at the rate in effect (pay-rate history, migration 0061).

const NY = "America/New_York";
const week = ["2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12"];
const base = (effectiveFrom: string, hourlyRate: number | null, employeeId = 1): PayRateRow =>
  ({ employeeId, positionId: null, effectiveFrom, hourlyRate });
const shift = (date: string, startMinutes: number, endMinutes: number, extra: { employeeId?: number; positionId?: number | null } = {}) =>
  ({ employeeId: extra.employeeId ?? 1, date, startMinutes, endMinutes, positionId: extra.positionId ?? null });

describe("scheduledCostByDay", () => {
  it("matches computeLaborCost exactly with one rate all week", () => {
    // 5 × 9h = 45h at $20 → 950, as before rate history.
    const shifts = week.slice(2).map((d) => shift(d, 480, 1020));
    const [row] = scheduledCostByDay(shifts, week, makeRateLookup([base(RATE_BEGINNING, 20)]), NY);
    expect(row.cost).toBe(computeLaborCost({ totalMinutes: 2700, payRate: 20 }).cost);
    expect(row.cost).toBe(950);
    expect(row.overtimeMinutes).toBe(300);
  });

  it("costs each day at the rate in effect, and the days add up to the week", () => {
    const shifts = week.slice(2).map((d) => shift(d, 480, 960)); // 5 × 8h
    const [row] = scheduledCostByDay(shifts, week, makeRateLookup([base(RATE_BEGINNING, 15), base("2026-06-10", 20)]), NY);
    expect(row.days).toEqual({
      "2026-06-06": 0, "2026-06-07": 0, "2026-06-08": 120, "2026-06-09": 120,
      "2026-06-10": 160, "2026-06-11": 160, "2026-06-12": 160,
    });
    expect(row.cost).toBe(720);
  });

  it("splits an overnight shift at midnight into a raise", () => {
    // Tue 8 PM → Wed 4 AM (end 1680), raise Wed: 4h × 15 + 4h × 20, all on Tuesday's row.
    const [row] = scheduledCostByDay([shift("2026-06-09", 1200, 1680)], week, makeRateLookup([base(RATE_BEGINNING, 15), base("2026-06-10", 20)]), NY);
    expect(row.cost).toBe(140);
    expect(row.days["2026-06-09"]).toBe(140);
    expect(row.days["2026-06-10"]).toBe(0);
  });

  it("puts the week's overtime on its last scheduled hours", () => {
    // 45h, raise on the last day: the 5h of overtime are on that day.
    const shifts = week.slice(2).map((d) => shift(d, 480, 1020));
    const [row] = scheduledCostByDay(shifts, week, makeRateLookup([base(RATE_BEGINNING, 20), base("2026-06-12", 30)]), NY);
    expect(row.days["2026-06-12"]).toBe(4 * 30 + 5 * 30 * 1.5);
    expect(row.cost).toBe(4 * 9 * 20 + 4 * 30 + 5 * 30 * 1.5);
  });

  it("uses a position rate for a shift in that position", () => {
    const rates = makeRateLookup([base(RATE_BEGINNING, 15), { employeeId: 1, positionId: 3, effectiveFrom: RATE_BEGINNING, hourlyRate: 25 }]);
    const [row] = scheduledCostByDay([shift("2026-06-09", 480, 960, { positionId: 3 }), shift("2026-06-10", 480, 960)], week, rates, NY);
    expect(row.days["2026-06-09"]).toBe(200);
    expect(row.days["2026-06-10"]).toBe(120);
  });

  it("gives a null cost with no rate, and flags a partly-rated week", () => {
    const [none] = scheduledCostByDay([shift("2026-06-09", 480, 960)], week, makeRateLookup([]), NY);
    expect(none).toMatchObject({ cost: null, missingRate: true, totalMinutes: 480 });
    const [part] = scheduledCostByDay(
      [shift("2026-06-09", 480, 960), shift("2026-06-10", 480, 960)], week, makeRateLookup([base("2026-06-10", 20)]), NY);
    expect(part).toMatchObject({ cost: 160, missingRate: true });
  });

  it("costs the real hours of a shift across DST (fall-back night is an hour longer)", () => {
    const fallWeek = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
    const [row] = scheduledCostByDay([shift("2026-11-01", 1, 480)], fallWeek, makeRateLookup([base(RATE_BEGINNING, 10)]), NY);
    expect(row.totalMinutes).toBe(539);
    expect(row.cost).toBe(89.83);
  });

  it("costs the real hours on the spring-forward night", () => {
    const springWeek = ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"];
    const [row] = scheduledCostByDay([shift("2026-03-08", 60, 480)], springWeek, makeRateLookup([base(RATE_BEGINNING, 10)]), NY);
    expect(row.totalMinutes).toBe(360);
    expect(row.cost).toBe(60);
  });

  it("ignores shifts outside the week and rounds days so they sum to the week", () => {
    const shifts = [shift("2026-06-01", 480, 960), shift("2026-06-08", 480, 500), shift("2026-06-09", 480, 500), shift("2026-06-10", 480, 500)];
    const [row] = scheduledCostByDay(shifts, week, makeRateLookup([base(RATE_BEGINNING, 10.01)]), NY);
    // 3 × 20 min at $10.01 = $10.01; each day 3.3366… → 3.34 + 3.34 + 3.33 (or so), adding up.
    expect(row.cost).toBe(10.01);
    const sum = Object.values(row.days).reduce((s, x) => s + Math.round(x * 100), 0);
    expect(sum).toBe(1001);
  });

  it("returns nothing for an empty week", () => {
    expect(scheduledCostByDay([], week, makeRateLookup([]), NY)).toEqual([]);
  });
});
