import { describe, it, expect } from "vitest";
import { EMAIL_RE, isValidEmail } from "./email";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("first.last+tag@mail.example.co.uk")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "a", "a@b", "a@.com", "a@b.", "a@b..com", "a b@c.com", "a@b@c.com"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("rejects addresses over 254 characters", () => {
    expect(isValidEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
  });

  // Regression: the old /^[^\s@]+@[^\s@]+\.[^\s@]+$/ backtracked polynomially on
  // "!@!." + "!.".repeat(n) + "!" (CodeQL js/polynomial-redos).
  it("stays fast on the CodeQL ReDoS input", () => {
    const attack = "!@!." + "!.".repeat(50_000) + "\n";
    const start = performance.now();
    // The regex itself, since isValidEmail's length cap would short-circuit.
    expect(EMAIL_RE.test(attack)).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
