import { describe, it, expect } from "vitest";
import { validateIncident, INCIDENT_SEVERITIES } from "./incident";

describe("validateIncident", () => {
  const base = { date: "2026-06-17", severity: "minor", description: "  Slipped on wet floor " };

  it("accepts and trims a valid incident", () => {
    expect(validateIncident(base)).toEqual({
      valid: true,
      value: { date: "2026-06-17", severity: "minor", description: "Slipped on wet floor" },
    });
  });

  it("rejects a bad date", () => {
    expect(validateIncident({ ...base, date: "06-17-2026" }).valid).toBe(false);
  });

  it("rejects an unknown severity", () => {
    expect(validateIncident({ ...base, severity: "catastrophic" }).valid).toBe(false);
  });

  it("rejects an empty description", () => {
    expect(validateIncident({ ...base, description: "   " }).valid).toBe(false);
  });

  it("rejects an over-long description", () => {
    expect(validateIncident({ ...base, description: "x".repeat(2001) }).valid).toBe(false);
  });

  it("covers the three severities", () => {
    expect(INCIDENT_SEVERITIES).toEqual(["minor", "moderate", "severe"]);
  });
});
