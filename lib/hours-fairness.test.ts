import { describe, it, expect } from "vitest";
import { fairnessSummary, classifyFairness } from "./hours-fairness";

const employees = [
  { employeeId: 1, totalMinutes: 2400 }, // 40h
  { employeeId: 2, totalMinutes: 1200 }, // 20h
  { employeeId: 3, totalMinutes: 600 },  // 10h
];

describe("fairnessSummary", () => {
  it("computes count, total, mean, min, max, and spread", () => {
    expect(fairnessSummary(employees)).toEqual({
      count: 3,
      totalMinutes: 4200,
      meanMinutes: 1400,
      minMinutes: 600,
      maxMinutes: 2400,
      spreadMinutes: 1800,
    });
  });

  it("handles an empty list", () => {
    expect(fairnessSummary([])).toEqual({
      count: 0, totalMinutes: 0, meanMinutes: 0, minMinutes: 0, maxMinutes: 0, spreadMinutes: 0,
    });
  });
});

describe("classifyFairness", () => {
  it("flags under/over relative to the mean within a tolerance", () => {
    // mean = 1400; tolerance 480 (8h): under <= 920, over >= 1880.
    const rows = classifyFairness(employees, 480);
    const byId = Object.fromEntries(rows.map((r) => [r.employeeId, r]));
    expect(byId[1].status).toBe("over");   // 2400, +1000
    expect(byId[2].status).toBe("fair");   // 1200, -200
    expect(byId[3].status).toBe("under");  // 600, -800
    expect(byId[1].deviationMinutes).toBe(1000);
    expect(byId[3].deviationMinutes).toBe(-800);
  });

  it("sorts by total minutes descending", () => {
    expect(classifyFairness(employees).map((r) => r.employeeId)).toEqual([1, 2, 3]);
  });

  it("treats everyone as fair when nobody exceeds the tolerance", () => {
    const rows = classifyFairness([{ employeeId: 1, totalMinutes: 600 }, { employeeId: 2, totalMinutes: 660 }], 480);
    expect(rows.every((r) => r.status === "fair")).toBe(true);
  });

  it("returns an empty list for no employees", () => {
    expect(classifyFairness([])).toEqual([]);
  });
});
