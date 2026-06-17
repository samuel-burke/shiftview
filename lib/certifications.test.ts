import { describe, it, expect } from "vitest";
import {
  daysUntil,
  certificationStatus,
  summarizeCertifications,
} from "./certifications";

describe("daysUntil", () => {
  it("is positive for a future date", () => {
    expect(daysUntil("2026-06-20", "2026-06-17")).toBe(3);
  });
  it("is zero on the expiry day", () => {
    expect(daysUntil("2026-06-17", "2026-06-17")).toBe(0);
  });
  it("is negative once past", () => {
    expect(daysUntil("2026-06-10", "2026-06-17")).toBe(-7);
  });
});

describe("certificationStatus", () => {
  const today = "2026-06-17";

  it("is no_expiry when there is no expiry date", () => {
    expect(certificationStatus(null, today)).toBe("no_expiry");
  });
  it("is expired when the date has passed", () => {
    expect(certificationStatus("2026-06-16", today)).toBe("expired");
  });
  it("is expiring within the warning window (inclusive of today)", () => {
    expect(certificationStatus("2026-06-17", today)).toBe("expiring");
    expect(certificationStatus("2026-07-10", today)).toBe("expiring"); // 23 days
  });
  it("is valid well beyond the window", () => {
    expect(certificationStatus("2026-08-01", today)).toBe("valid");
  });
  it("honors a custom warning window", () => {
    expect(certificationStatus("2026-06-25", today, 5)).toBe("valid"); // 8 days > 5
    expect(certificationStatus("2026-06-25", today, 10)).toBe("expiring"); // 8 days <= 10
  });
});

describe("summarizeCertifications", () => {
  const today = "2026-06-17";
  const certs = [
    { expiresOn: null },             // no_expiry
    { expiresOn: "2026-06-10" },     // expired
    { expiresOn: "2026-06-20" },     // expiring
    { expiresOn: "2026-12-01" },     // valid
    { expiresOn: "2026-06-17" },     // expiring (today)
  ];

  it("tallies each status", () => {
    const s = summarizeCertifications(certs, today);
    expect(s).toEqual({ total: 5, valid: 1, expiring: 2, expired: 1, noExpiry: 1, actionNeeded: 3 });
  });

  it("counts actionNeeded as expiring + expired", () => {
    const s = summarizeCertifications([{ expiresOn: "2026-06-10" }], today);
    expect(s.actionNeeded).toBe(1);
  });

  it("handles an empty list", () => {
    expect(summarizeCertifications([], today)).toEqual({
      total: 0, valid: 0, expiring: 0, expired: 0, noExpiry: 0, actionNeeded: 0,
    });
  });
});
