import { describe, it, expect } from "vitest";
import { validateEmployeeNote, EMPLOYEE_NOTE_MAX } from "./employee-note";

describe("validateEmployeeNote", () => {
  it("accepts and trims a note", () => {
    expect(validateEmployeeNote("  Coached on punctuality ")).toEqual({
      valid: true,
      value: "Coached on punctuality",
    });
  });
  it("rejects empty/whitespace", () => {
    expect(validateEmployeeNote("").valid).toBe(false);
    expect(validateEmployeeNote("   ").valid).toBe(false);
  });
  it("rejects a non-string", () => {
    expect(validateEmployeeNote(null as unknown).valid).toBe(false);
  });
  it("rejects an over-long note", () => {
    expect(validateEmployeeNote("x".repeat(EMPLOYEE_NOTE_MAX + 1)).valid).toBe(false);
  });
  it("accepts a note exactly at the max length", () => {
    expect(validateEmployeeNote("x".repeat(EMPLOYEE_NOTE_MAX)).valid).toBe(true);
  });
});
