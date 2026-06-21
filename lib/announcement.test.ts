import { describe, it, expect } from "vitest";
import {
  validateAnnouncement,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_BODY_MAX,
} from "./announcement";

describe("validateAnnouncement", () => {
  it("accepts and trims a valid announcement", () => {
    const r = validateAnnouncement({ title: "  Inventory ", body: " Closed Monday " });
    expect(r).toEqual({ valid: true, value: { title: "Inventory", body: "Closed Monday" } });
  });

  it("rejects a missing or empty title", () => {
    expect(validateAnnouncement({ title: "", body: "x" }).valid).toBe(false);
    expect(validateAnnouncement({ title: "   ", body: "x" }).valid).toBe(false);
    expect(validateAnnouncement({ body: "x" }).valid).toBe(false);
  });

  it("rejects a missing or empty body", () => {
    expect(validateAnnouncement({ title: "Hi", body: "" }).valid).toBe(false);
    expect(validateAnnouncement({ title: "Hi" }).valid).toBe(false);
  });

  it("rejects a non-string title or body", () => {
    expect(validateAnnouncement({ title: 5 as unknown, body: "x" }).valid).toBe(false);
    expect(validateAnnouncement({ title: "x", body: {} as unknown }).valid).toBe(false);
  });

  it("rejects a title over the max length", () => {
    expect(validateAnnouncement({ title: "x".repeat(ANNOUNCEMENT_TITLE_MAX + 1), body: "y" }).valid).toBe(false);
  });

  it("rejects a body over the max length", () => {
    expect(validateAnnouncement({ title: "x", body: "y".repeat(ANNOUNCEMENT_BODY_MAX + 1) }).valid).toBe(false);
  });

  it("accepts title and body exactly at the max length", () => {
    const r = validateAnnouncement({
      title: "x".repeat(ANNOUNCEMENT_TITLE_MAX),
      body: "y".repeat(ANNOUNCEMENT_BODY_MAX),
    });
    expect(r.valid).toBe(true);
  });
});
