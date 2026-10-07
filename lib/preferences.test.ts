import { describe, it, expect } from "vitest";
import { emptyPreferences, hasPreferences, preferencesFromRow, validatePreferencesInput } from "./preferences";

describe("preferencesFromRow", () => {
  it("maps columns, sorts days and coerces hours", () => {
    expect(
      preferencesFromRow({
        employee_id: 4,
        preferred_shift_types: ["closer", "opener"],
        preferred_days: [5, 1],
        avoid_days: [0],
        desired_weekly_hours: "24.5",
        note: "Class Tuesdays",
        updated_at: "2026-10-01T12:00:00Z",
      })
    ).toEqual({
      employeeId: 4,
      preferredShiftTypes: ["closer", "opener"],
      preferredDays: [1, 5],
      avoidDays: [0],
      desiredWeeklyHours: 24.5,
      note: "Class Tuesdays",
      updatedAt: "2026-10-01T12:00:00Z",
    });
  });

  it("drops shift types it doesn't know", () => {
    const p = preferencesFromRow({
      employee_id: 1, preferred_shift_types: ["mid", "graveyard"], preferred_days: null, avoid_days: null,
      desired_weekly_hours: null, note: null, updated_at: null,
    });
    expect(p.preferredShiftTypes).toEqual(["mid"]);
    expect(p.preferredDays).toEqual([]);
  });
});

describe("hasPreferences", () => {
  it("is false for empty preferences and true once anything is set", () => {
    expect(hasPreferences(emptyPreferences(1))).toBe(false);
    expect(hasPreferences({ ...emptyPreferences(1), avoidDays: [0] })).toBe(true);
    expect(hasPreferences({ ...emptyPreferences(1), desiredWeeklyHours: 20 })).toBe(true);
  });
});

describe("validatePreferencesInput", () => {
  it("normalizes a full update", () => {
    expect(
      validatePreferencesInput({
        preferredShiftTypes: ["closer", "opener", "closer"],
        preferredDays: [6, 2, 2],
        avoidDays: [0],
        desiredWeeklyHours: 22.5,
        note: "  Weekends are best  ",
      })
    ).toEqual({
      values: {
        preferred_shift_types: ["opener", "closer"],
        preferred_days: [2, 6],
        avoid_days: [0],
        desired_weekly_hours: 22.5,
        note: "Weekends are best",
      },
      error: null,
    });
  });

  it("clears omitted fields", () => {
    expect(validatePreferencesInput({})).toEqual({
      values: { preferred_shift_types: [], preferred_days: [], avoid_days: [], desired_weekly_hours: null, note: null },
      error: null,
    });
  });

  it.each([
    [{ preferredShiftTypes: ["swing"] }, /preferredShiftTypes/],
    [{ preferredShiftTypes: "opener" }, /preferredShiftTypes/],
    [{ preferredDays: [7] }, /preferredDays/],
    [{ avoidDays: [1.5] }, /avoidDays/],
    [{ preferredDays: [1, 2], avoidDays: [2] }, /both preferred and avoided/],
    [{ desiredWeeklyHours: 20.25 }, /desiredWeeklyHours/],
    [{ desiredWeeklyHours: 81 }, /desiredWeeklyHours/],
    [{ note: 5 }, /note/],
    [{ note: "x".repeat(501) }, /500/],
  ])("rejects %j", (input, message) => {
    expect(validatePreferencesInput(input).error).toMatch(message);
  });
});
