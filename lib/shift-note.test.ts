import { describe, it, expect } from "vitest";
import { validateShiftNote, SHIFT_NOTE_MAX } from "./shift-note";

describe("validateShiftNote", () => {
  it("treats null as clearing the note", () => {
    expect(validateShiftNote(null)).toEqual({ valid: true, value: null });
  });

  it("treats an empty or whitespace string as clearing the note", () => {
    expect(validateShiftNote("")).toEqual({ valid: true, value: null });
    expect(validateShiftNote("   ")).toEqual({ valid: true, value: null });
  });

  it("trims a normal note", () => {
    expect(validateShiftNote("  Lock up tonight ")).toEqual({ valid: true, value: "Lock up tonight" });
  });

  it("rejects a non-string, non-null value", () => {
    expect(validateShiftNote(5 as unknown).valid).toBe(false);
  });

  it("rejects a note over the max length", () => {
    expect(validateShiftNote("x".repeat(SHIFT_NOTE_MAX + 1)).valid).toBe(false);
  });

  it("accepts a note exactly at the max length", () => {
    const r = validateShiftNote("x".repeat(SHIFT_NOTE_MAX));
    expect(r.valid).toBe(true);
  });
});
