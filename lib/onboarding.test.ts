import { describe, it, expect } from "vitest";
import {
  validateOnboardingLabel,
  onboardingProgress,
  ONBOARDING_LABEL_MAX,
} from "./onboarding";

describe("validateOnboardingLabel", () => {
  it("accepts and trims a label", () => {
    expect(validateOnboardingLabel("  Sign W-4 ")).toEqual({ valid: true, value: "Sign W-4" });
  });
  it("rejects empty/whitespace", () => {
    expect(validateOnboardingLabel("").valid).toBe(false);
    expect(validateOnboardingLabel("   ").valid).toBe(false);
  });
  it("rejects a non-string", () => {
    expect(validateOnboardingLabel(7 as unknown).valid).toBe(false);
  });
  it("rejects an over-long label", () => {
    expect(validateOnboardingLabel("x".repeat(ONBOARDING_LABEL_MAX + 1)).valid).toBe(false);
  });
});

describe("onboardingProgress", () => {
  it("counts done vs total and computes a percentage", () => {
    const p = onboardingProgress([{ done: true }, { done: false }, { done: true }, { done: false }]);
    expect(p).toEqual({ total: 4, done: 2, pct: 50, complete: false });
  });
  it("is complete when every item is done", () => {
    expect(onboardingProgress([{ done: true }, { done: true }])).toEqual({ total: 2, done: 2, pct: 100, complete: true });
  });
  it("handles an empty checklist as not complete", () => {
    expect(onboardingProgress([])).toEqual({ total: 0, done: 0, pct: 0, complete: false });
  });
});
