import { describe, it, expect } from "vitest";
import { DEFAULT_PUNCH_POLICY, parsePunchPolicy, punchPolicyRows } from "./punch-policy";

describe("parsePunchPolicy", () => {
  it("returns defaults for an empty map", () => {
    expect(parsePunchPolicy({})).toEqual(DEFAULT_PUNCH_POLICY);
  });

  it("parses booleans and integers from the settings map", () => {
    const policy = parsePunchPolicy({
      punch_late_in_enabled: "false",
      punch_late_in_minutes: "10",
      punch_early_out_enabled: "true",
      punch_max_breaks_per_shift: "2",
    });
    expect(policy.lateInEnabled).toBe(false);
    expect(policy.lateInMinutes).toBe(10);
    expect(policy.earlyOutEnabled).toBe(true);
    expect(policy.maxBreaksPerShift).toBe(2);
  });

  it("falls back to defaults for malformed values", () => {
    const policy = parsePunchPolicy({ punch_late_in_minutes: "abc" });
    expect(policy.lateInMinutes).toBe(DEFAULT_PUNCH_POLICY.lateInMinutes);
  });
});

describe("punchPolicyRows", () => {
  it("converts a valid patch to key/value rows", () => {
    const { rows, error } = punchPolicyRows({ lateInEnabled: true, lateInMinutes: 7, maxBreaksPerShift: 3 });
    expect(error).toBeNull();
    expect(rows).toContainEqual({ key: "punch_late_in_enabled", value: "true" });
    expect(rows).toContainEqual({ key: "punch_late_in_minutes", value: "7" });
    expect(rows).toContainEqual({ key: "punch_max_breaks_per_shift", value: "3" });
  });

  it("rejects a non-boolean enabled flag", () => {
    const { error } = punchPolicyRows({ lateInEnabled: "yes" });
    expect(error).toMatch(/lateInEnabled/);
  });

  it("rejects an out-of-range minutes value", () => {
    const { error } = punchPolicyRows({ lateInMinutes: 9999 });
    expect(error).toMatch(/lateInMinutes/);
  });

  it("rejects a negative break cap", () => {
    const { error } = punchPolicyRows({ maxBreaksPerShift: -1 });
    expect(error).toMatch(/maxBreaksPerShift/);
  });

  it("ignores fields that are not part of the policy", () => {
    const { rows, error } = punchPolicyRows({ somethingElse: true });
    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });
});
