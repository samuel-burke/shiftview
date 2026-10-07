import { describe, it, expect } from "vitest";
import { swapDate } from "./swaps";

describe("swapDate", () => {
  it("is the shared day when both shifts are on it", () => {
    expect(swapDate({ schedule_a: { date: "2026-10-09" }, schedule_b: { date: "2026-10-09" } })).toBe("2026-10-09");
  });

  it("is the earlier of the two shifts' days", () => {
    expect(swapDate({ schedule_a: { date: "2026-10-12" }, schedule_b: { date: "2026-10-09" } })).toBe("2026-10-09");
    expect(swapDate({ schedule_a: { date: "2026-10-09" }, schedule_b: { date: "2026-10-12" } })).toBe("2026-10-09");
  });

  it("accepts embeds returned as one-element arrays", () => {
    expect(swapDate({ schedule_a: [{ date: "2026-10-09" }], schedule_b: [] })).toBe("2026-10-09");
  });

  it("uses whichever shift's date is known, or null for neither", () => {
    expect(swapDate({ schedule_a: null, schedule_b: { date: "2026-10-10" } })).toBe("2026-10-10");
    expect(swapDate({})).toBeNull();
  });
});
