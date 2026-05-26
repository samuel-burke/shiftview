import { describe, it, expect } from "vitest";
import { validateShiftMinutes } from "./validation";

describe("validateShiftMinutes", () => {
  it("returns null for a valid shift", () => {
    expect(validateShiftMinutes(480, 960)).toBeNull(); // 8am–4pm
  });

  it("rejects non-integer startMinutes", () => {
    expect(validateShiftMinutes(8.5, 960)).toBe("startMinutes and endMinutes must be integers");
  });

  it("rejects non-integer endMinutes", () => {
    expect(validateShiftMinutes(480, 960.5)).toBe("startMinutes and endMinutes must be integers");
  });

  it("rejects string inputs", () => {
    expect(validateShiftMinutes("480", 960)).toBe("startMinutes and endMinutes must be integers");
  });

  it("rejects null inputs", () => {
    expect(validateShiftMinutes(null, 960)).toBe("startMinutes and endMinutes must be integers");
  });

  it("rejects startMinutes below 0", () => {
    expect(validateShiftMinutes(-1, 960)).toBe("startMinutes must be between 0 and 1439");
  });

  it("rejects startMinutes at 1440 (end of day)", () => {
    expect(validateShiftMinutes(1440, 1440)).toBe("startMinutes must be between 0 and 1439");
  });

  it("accepts startMinutes of 0 (midnight)", () => {
    expect(validateShiftMinutes(0, 60)).toBeNull();
  });

  it("rejects endMinutes of 0", () => {
    expect(validateShiftMinutes(0, 0)).toBe("endMinutes must be between 1 and 1440");
  });

  it("rejects endMinutes above 1440", () => {
    expect(validateShiftMinutes(480, 1441)).toBe("endMinutes must be between 1 and 1440");
  });

  it("accepts endMinutes of exactly 1440 (midnight)", () => {
    expect(validateShiftMinutes(480, 1440)).toBeNull();
  });

  it("rejects start equal to end", () => {
    expect(validateShiftMinutes(480, 480)).toBe("startMinutes must be less than endMinutes");
  });

  it("rejects start after end", () => {
    expect(validateShiftMinutes(960, 480)).toBe("startMinutes must be less than endMinutes");
  });

  it("rejects shifts shorter than 60 minutes", () => {
    expect(validateShiftMinutes(480, 539)).toBe("shift must be at least 1 hour");
  });

  it("accepts a shift of exactly 60 minutes", () => {
    expect(validateShiftMinutes(480, 540)).toBeNull();
  });

  it("rejects shifts longer than 960 minutes (16 hours)", () => {
    expect(validateShiftMinutes(0, 961)).toBe("shift cannot exceed 16 hours");
  });

  it("accepts a shift of exactly 960 minutes", () => {
    expect(validateShiftMinutes(0, 960)).toBeNull();
  });
});
