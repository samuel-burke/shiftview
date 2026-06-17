import { describe, it, expect } from "vitest";
import { validateContactInfo } from "./contact-info";

describe("validateContactInfo", () => {
  it("accepts and trims valid fields", () => {
    const r = validateContactInfo({
      phone: "  (555) 123-4567 ",
      emergencyContactName: "  Pat Doe ",
      emergencyContactPhone: "+1 555 987 6543",
    });
    expect(r).toEqual({
      valid: true,
      value: {
        phone: "(555) 123-4567",
        emergencyContactName: "Pat Doe",
        emergencyContactPhone: "+1 555 987 6543",
      },
    });
  });

  it("treats empty/whitespace/omitted fields as null (clearing)", () => {
    expect(validateContactInfo({ phone: "", emergencyContactName: "   " })).toEqual({
      valid: true,
      value: { phone: null, emergencyContactName: null, emergencyContactPhone: null },
    });
    expect(validateContactInfo({})).toEqual({
      valid: true,
      value: { phone: null, emergencyContactName: null, emergencyContactPhone: null },
    });
  });

  it("rejects a phone with too few digits", () => {
    expect(validateContactInfo({ phone: "12345" }).valid).toBe(false);
  });

  it("rejects a phone containing letters", () => {
    expect(validateContactInfo({ phone: "555-CALL-NOW" }).valid).toBe(false);
  });

  it("rejects an over-long emergency contact name", () => {
    expect(validateContactInfo({ emergencyContactName: "x".repeat(81) }).valid).toBe(false);
  });

  it("rejects a non-string field", () => {
    expect(validateContactInfo({ phone: 5551234567 as unknown }).valid).toBe(false);
  });
});
