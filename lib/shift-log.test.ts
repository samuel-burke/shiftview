import { describe, it, expect } from "vitest";
import { validateShiftLogEntry, SHIFT_LOG_MAX } from "./shift-log";

describe("validateShiftLogEntry", () => {
  it("accepts and trims a normal entry", () => {
    expect(validateShiftLogEntry("  Freezer running warm ")).toEqual({
      valid: true,
      value: "Freezer running warm",
    });
  });

  it("rejects an empty or whitespace entry", () => {
    expect(validateShiftLogEntry("").valid).toBe(false);
    expect(validateShiftLogEntry("   ").valid).toBe(false);
  });

  it("rejects a non-string", () => {
    expect(validateShiftLogEntry(5 as unknown).valid).toBe(false);
    expect(validateShiftLogEntry(null as unknown).valid).toBe(false);
  });

  it("rejects an entry over the max length", () => {
    expect(validateShiftLogEntry("x".repeat(SHIFT_LOG_MAX + 1)).valid).toBe(false);
  });

  it("accepts an entry exactly at the max length", () => {
    expect(validateShiftLogEntry("x".repeat(SHIFT_LOG_MAX)).valid).toBe(true);
  });
});
