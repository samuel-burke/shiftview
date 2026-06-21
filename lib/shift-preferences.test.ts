import { describe, it, expect } from "vitest";
import {
  SHIFT_TYPES,
  validateShiftPreferences,
  parseShiftPreferences,
  serializeShiftPreferences,
  matchesPreference,
} from "./shift-preferences";

describe("validateShiftPreferences", () => {
  it("accepts a valid subset and dedupes/orders it", () => {
    expect(validateShiftPreferences(["closer", "opener", "opener"])).toEqual({
      valid: true,
      value: ["opener", "closer"],
    });
  });
  it("accepts an empty array (no preference)", () => {
    expect(validateShiftPreferences([])).toEqual({ valid: true, value: [] });
  });
  it("rejects a non-array", () => {
    expect(validateShiftPreferences("opener" as unknown).valid).toBe(false);
  });
  it("rejects an unknown shift type", () => {
    expect(validateShiftPreferences(["graveyard"]).valid).toBe(false);
  });
  it("covers exactly the three shift types", () => {
    expect(SHIFT_TYPES).toEqual(["opener", "mid", "closer"]);
  });
});

describe("parse / serialize", () => {
  it("round-trips through a comma-separated string", () => {
    expect(serializeShiftPreferences(["opener", "closer"])).toBe("opener,closer");
    expect(parseShiftPreferences("opener,closer")).toEqual(["opener", "closer"]);
  });
  it("parses null/empty to an empty list", () => {
    expect(parseShiftPreferences(null)).toEqual([]);
    expect(parseShiftPreferences("")).toEqual([]);
  });
  it("drops unknown tokens when parsing", () => {
    expect(parseShiftPreferences("opener,bogus,closer")).toEqual(["opener", "closer"]);
  });
});

describe("matchesPreference", () => {
  it("matches anything when there is no preference", () => {
    expect(matchesPreference("mid", [])).toBe(true);
  });
  it("matches only the preferred types otherwise", () => {
    expect(matchesPreference("opener", ["opener", "closer"])).toBe(true);
    expect(matchesPreference("mid", ["opener", "closer"])).toBe(false);
  });
});
