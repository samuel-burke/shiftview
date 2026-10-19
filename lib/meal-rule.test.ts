import { describe, it, expect } from "vitest";
import { mealFlags, type MealPunch } from "./meal-rule";

let nextId = 1;
// Minutes after 9:00 AM EST on Thu Jan 15 2026 (14:00Z).
const BASE = Date.parse("2026-01-15T14:00:00Z");
function p(punchType: string, minutes: number, extra: Partial<MealPunch> = {}): MealPunch {
  return { id: nextId++, punchType, punchedAt: new Date(BASE + minutes * 60_000).toISOString(), ...extra };
}
const FIVE_H = 300;

describe("mealFlags", () => {
  it("is off when the rule is 0", () => {
    expect(mealFlags([p("clock_in", 0), p("clock_out", 600)], 0)).toEqual([]);
  });

  it("needs no meal for a shift of exactly N hours", () => {
    expect(mealFlags([p("clock_in", 0), p("clock_out", FIVE_H)], FIVE_H)).toEqual([]);
  });

  it("flags a missed meal one minute past N hours", () => {
    const out = p("clock_out", FIVE_H + 1);
    expect(mealFlags([p("clock_in", 0), out], FIVE_H)).toEqual([
      { kind: "missed", workedMinutes: 301, workedBeforeMealMinutes: null, punchId: out.id },
    ]);
  });

  it("accepts a meal that starts at exactly N hours of work", () => {
    expect(mealFlags([
      p("clock_in", 0), p("break_start", FIVE_H), p("break_end", FIVE_H + 30), p("clock_out", 540),
    ], FIVE_H)).toEqual([]);
  });

  it("flags a meal that starts a minute after N hours as late", () => {
    const start = p("break_start", FIVE_H + 1);
    expect(mealFlags([p("clock_in", 0), start, p("break_end", FIVE_H + 31), p("clock_out", 540)], FIVE_H)).toEqual([
      { kind: "late", workedMinutes: 510, workedBeforeMealMinutes: 301, punchId: start.id },
    ]);
  });

  it("measures worked time, not time since clock-in: an earlier unpaid break doesn't count as work", () => {
    // 15 min unpaid break at 2h (too short for a meal), meal at 5h 10m on the
    // clock = 4h 55m worked: on time.
    expect(mealFlags([
      p("clock_in", 0), p("break_start", 120), p("break_end", 135),
      p("break_start", 310), p("break_end", 340), p("clock_out", 540),
    ], FIVE_H)).toEqual([]);
  });

  it("counts a paid break as work and never as the meal", () => {
    const out = p("clock_out", 360);
    const flags = mealFlags([
      p("clock_in", 0), p("break_start", 120, { breakPaid: true }), p("break_end", 160), out,
    ], FIVE_H);
    expect(flags).toEqual([{ kind: "missed", workedMinutes: 360, workedBeforeMealMinutes: null, punchId: out.id }]);
  });

  it("needs a meal of at least 30 minutes when its type sets no minimum", () => {
    expect(mealFlags([
      p("clock_in", 0), p("break_start", 200), p("break_end", 229), p("clock_out", 480),
    ], FIVE_H)[0]?.kind).toBe("missed");
    expect(mealFlags([
      p("clock_in", 0), p("break_start", 200), p("break_end", 230), p("clock_out", 480),
    ], FIVE_H)).toEqual([]);
  });

  it("uses the break type's own minimum", () => {
    const min = (id: number | null | undefined) => (id === 7 ? 20 : null);
    expect(mealFlags([
      p("clock_in", 0), p("break_start", 200, { breakTypeId: 7 }), p("break_end", 220), p("clock_out", 480),
    ], FIVE_H, min)).toEqual([]);
    expect(mealFlags([
      p("clock_in", 0), p("break_start", 200, { breakTypeId: 7 }), p("break_end", 219), p("clock_out", 480),
    ], FIVE_H, min)[0]?.kind).toBe("missed");
  });

  it("uses the first qualifying meal of the shift", () => {
    expect(mealFlags([
      p("clock_in", 0), p("break_start", 240), p("break_end", 270),
      p("break_start", 400), p("break_end", 430), p("clock_out", 720),
    ], FIVE_H)).toEqual([]);
  });

  it("doesn't judge a shift still open", () => {
    expect(mealFlags([p("clock_in", 0), p("break_start", 400)], FIVE_H)).toEqual([]);
    expect(mealFlags([p("clock_in", 0)], FIVE_H)).toEqual([]);
  });

  it("judges each shift of a split day on its own", () => {
    const out2 = p("clock_out", 1080);
    expect(mealFlags([
      p("clock_in", 0), p("clock_out", 240),
      p("clock_in", 600), out2,
    ], FIVE_H)).toEqual([{ kind: "missed", workedMinutes: 480, workedBeforeMealMinutes: null, punchId: out2.id }]);
  });

  it("measures real elapsed time across the fall-back hour", () => {
    // Midnight EDT to 5:30 AM EST on Nov 1 2026 is 6h 30m of real time.
    const at = (iso: string, punchType: string) => ({ id: nextId++, punchType, punchedAt: iso });
    const out = at("2026-11-01T10:30:00Z", "clock_out");
    expect(mealFlags([at("2026-11-01T04:00:00Z", "clock_in"), out], 360)).toEqual([
      { kind: "missed", workedMinutes: 390, workedBeforeMealMinutes: null, punchId: out.id },
    ]);
    // Same wall-clock span on the spring-forward night is 4h 30m: no meal needed.
    expect(mealFlags([at("2026-03-08T05:00:00Z", "clock_in"), at("2026-03-08T09:30:00Z", "clock_out")], 300)).toEqual([]);
  });
});
