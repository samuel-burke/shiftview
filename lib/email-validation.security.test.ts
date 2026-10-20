import { describe, expect, it } from "vitest";
import { isValidEmail } from "./email-validation";

describe("isValidEmail", () => {
  it.each([
    "alice@example.com",
    "first.last+tag@sub.example.co.uk",
    "a@b..",
    "a@..b",
    `a@${"b".repeat(248)}.com`, // 254 characters
  ])("accepts the supported email format: %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    undefined, null, true, 123, ["alice@example.com"], {},
    "", "alice", "@example.com", "a@@example.com", "a@b", "a@.b", "a@b.",
    "a b@example.com", "a@b. c", "a@b.com\n", "a@b.\u00a0c",
    `a@${"b".repeat(249)}.com`, // 255 characters
  ])("rejects invalid or oversized input: %j", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it("rejects adversarial domains that caused quadratic backtracking", () => {
    expect(isValidEmail(`a@${".".repeat(16000)}! `)).toBe(false);
  });

  it("does not coerce non-string input", () => {
    expect(isValidEmail({ toString: () => { throw new Error("must not coerce"); } })).toBe(false);
  });
});
