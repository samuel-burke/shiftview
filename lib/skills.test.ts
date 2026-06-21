import { describe, it, expect } from "vitest";
import { validateSkillName, SKILL_NAME_MAX } from "./skills";

describe("validateSkillName", () => {
  it("accepts and trims a skill", () => {
    expect(validateSkillName("  Keyholder ")).toEqual({ valid: true, value: "Keyholder" });
  });
  it("rejects empty/whitespace", () => {
    expect(validateSkillName("").valid).toBe(false);
    expect(validateSkillName("   ").valid).toBe(false);
  });
  it("rejects a non-string", () => {
    expect(validateSkillName(9 as unknown).valid).toBe(false);
  });
  it("rejects an over-long skill", () => {
    expect(validateSkillName("x".repeat(SKILL_NAME_MAX + 1)).valid).toBe(false);
  });
  it("accepts a skill exactly at the max length", () => {
    expect(validateSkillName("x".repeat(SKILL_NAME_MAX)).valid).toBe(true);
  });
});
