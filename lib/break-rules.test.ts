import { describe, it, expect } from "vitest";
import {
  activeBreakTypes, breakRulesRows, DEFAULT_BREAK_RULES, parseBreakMinMinutes, parseBreakRules, parseBreakTypeName, toBreakType,
} from "./break-rules";

describe("parseBreakRules", () => {
  it("is all off with nothing stored", () => {
    expect(parseBreakRules({})).toEqual(DEFAULT_BREAK_RULES);
    expect(DEFAULT_BREAK_RULES).toEqual({ mealRequiredAfterMinutes: 0, attestationEnabled: false });
  });

  it("reads stored values", () => {
    expect(parseBreakRules({ meal_required_after_minutes: "300", break_attestation_enabled: "true" }))
      .toEqual({ mealRequiredAfterMinutes: 300, attestationEnabled: true });
  });

  it("treats junk or out-of-range values as off", () => {
    for (const v of ["", "abc", "-5", "59", "961", "300.5", "1e3"])
      expect(parseBreakRules({ meal_required_after_minutes: v }).mealRequiredAfterMinutes).toBe(0);
    expect(parseBreakRules({ break_attestation_enabled: "yes" }).attestationEnabled).toBe(false);
  });

  it("accepts the range edges", () => {
    expect(parseBreakRules({ meal_required_after_minutes: "60" }).mealRequiredAfterMinutes).toBe(60);
    expect(parseBreakRules({ meal_required_after_minutes: "960" }).mealRequiredAfterMinutes).toBe(960);
  });
});

describe("breakRulesRows", () => {
  it("writes the fields given", () => {
    expect(breakRulesRows({ mealRequiredAfterMinutes: 300, attestationEnabled: true })).toEqual({
      rows: [
        { key: "meal_required_after_minutes", value: "300" },
        { key: "break_attestation_enabled", value: "true" },
      ],
      error: null,
    });
    expect(breakRulesRows({ mealRequiredAfterMinutes: 0 }).rows).toEqual([{ key: "meal_required_after_minutes", value: "0" }]);
  });

  it("refuses bad values", () => {
    for (const patch of [null, [], "x", { mealRequiredAfterMinutes: 30 }, { mealRequiredAfterMinutes: 961 },
      { mealRequiredAfterMinutes: 300.5 }, { mealRequiredAfterMinutes: "300" }, { attestationEnabled: "true" }])
      expect(breakRulesRows(patch).error).not.toBeNull();
  });
});

describe("break types", () => {
  it("maps rows and orders the active ones", () => {
    const types = [
      { id: 3, name: "Meal", paid: false, min_minutes: 30, sort_order: 2, archived_at: null },
      { id: 1, name: "Rest", paid: true, min_minutes: null, sort_order: 1, archived_at: null },
      { id: 2, name: "Old", paid: true, min_minutes: null, sort_order: 0, archived_at: "2026-01-01T00:00:00Z" },
    ].map(toBreakType);
    expect(activeBreakTypes(types).map((t) => t.name)).toEqual(["Rest", "Meal"]);
    expect(types[0]).toEqual({ id: 3, name: "Meal", paid: false, minMinutes: 30, sortOrder: 2, archived: false });
  });

  it("validates names", () => {
    expect(parseBreakTypeName("  Rest   break ")).toEqual({ ok: true, name: "Rest break" });
    expect(parseBreakTypeName("   ").ok).toBe(false);
    expect(parseBreakTypeName(5).ok).toBe(false);
    expect(parseBreakTypeName("x".repeat(40)).ok).toBe(true);
    expect(parseBreakTypeName("x".repeat(41)).ok).toBe(false);
  });

  it("validates minimum lengths", () => {
    expect(parseBreakMinMinutes(null)).toEqual({ ok: true, value: null });
    expect(parseBreakMinMinutes(1)).toEqual({ ok: true, value: 1 });
    expect(parseBreakMinMinutes(240)).toEqual({ ok: true, value: 240 });
    for (const v of [0, 241, 10.5, "10", undefined]) expect(parseBreakMinMinutes(v).ok).toBe(false);
  });
});
