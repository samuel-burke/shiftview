import { describe, it, expect } from "vitest";
import { parseAdjustments } from "./adjustments";
import { WEEK } from "./__tests__/helpers";

const IDS = new Set([1, 2]);

describe("parseAdjustments", () => {
  it("accepts nothing", () => {
    expect(parseAdjustments(undefined, WEEK, IDS)).toEqual({ adjustments: [], error: null });
  });

  it("accepts each kind", () => {
    const adjustments = [
      { kind: "coverage", date: WEEK[3], startMinutes: 360, endMinutes: 600, delta: 2 },
      { kind: "employee_off", employeeId: 1, date: WEEK[4] },
      { kind: "employee_hours", employeeId: 2, maxHours: 44 },
    ];
    expect(parseAdjustments(adjustments, WEEK, IDS)).toEqual({
      adjustments: [
        adjustments[0],
        adjustments[1],
        { kind: "employee_hours", employeeId: 2, minHours: null, maxHours: 44 },
      ],
      error: null,
    });
  });

  it.each([
    ["not a list", { kind: "coverage" }, /list/],
    ["an unknown kind", [{ kind: "vibes" }], /kind/],
    ["a date outside the week", [{ kind: "coverage", date: "2026-01-01", startMinutes: 0, endMinutes: 60, delta: 1 }], /in the week/],
    ["times off the 15-minute grid", [{ kind: "coverage", date: WEEK[0], startMinutes: 10, endMinutes: 60, delta: 1 }], /15-minute/],
    ["a zero delta", [{ kind: "coverage", date: WEEK[0], startMinutes: 0, endMinutes: 60, delta: 0 }], /delta/],
    ["an unknown employee", [{ kind: "employee_off", employeeId: 9, date: WEEK[0] }], /unknown employee/],
    ["hours with neither end", [{ kind: "employee_hours", employeeId: 1 }], /minHours or maxHours/],
    ["quarter hours", [{ kind: "employee_hours", employeeId: 1, maxHours: 30.25 }], /half hours/],
    ["an inverted range", [{ kind: "employee_hours", employeeId: 1, minHours: 30, maxHours: 20 }], /cannot exceed/],
  ])("rejects %s", (_, input, message) => {
    expect(parseAdjustments(input, WEEK, IDS).error).toMatch(message);
  });

  it("caps how many there can be", () => {
    const many = Array.from({ length: 51 }, () => ({ kind: "employee_off", employeeId: 1, date: WEEK[0] }));
    expect(parseAdjustments(many, WEEK, IDS).error).toMatch(/at most 50/);
  });
});
