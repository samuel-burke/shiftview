import { describe, it, expect } from "vitest";
import {
  DEFAULT_BREAK_RULES,
  requiredBreaks,
  summarizeBreakRequirements,
} from "./break-rules";

describe("requiredBreaks", () => {
  it("requires a meal break only when the shift exceeds the threshold", () => {
    // Default threshold is 6h (360 min).
    expect(requiredBreaks(360).mealBreakRequired).toBe(false); // exactly 6h
    expect(requiredBreaks(361).mealBreakRequired).toBe(true);
    expect(requiredBreaks(480).mealBreakRequired).toBe(true); // 8h
  });

  it("grants one rest break per rest interval", () => {
    // Default: one rest break per 4h (240 min).
    expect(requiredBreaks(239).restBreaks).toBe(0);
    expect(requiredBreaks(240).restBreaks).toBe(1);
    expect(requiredBreaks(480).restBreaks).toBe(2);
    expect(requiredBreaks(540).restBreaks).toBe(2); // 9h
  });

  it("honors custom rules", () => {
    const rules = { mealBreakThresholdMinutes: 300, mealBreakMinutes: 45, restBreakPerMinutes: 0 };
    expect(requiredBreaks(301, rules).mealBreakRequired).toBe(true);
    expect(requiredBreaks(600, rules).restBreaks).toBe(0); // rest breaks disabled
  });

  it("exposes sane defaults", () => {
    expect(DEFAULT_BREAK_RULES.mealBreakThresholdMinutes).toBe(360);
    expect(DEFAULT_BREAK_RULES.mealBreakMinutes).toBe(30);
  });
});

describe("summarizeBreakRequirements", () => {
  const shifts = [
    { startMinutes: 480, endMinutes: 1020 }, // 9h → meal + 2 rest
    { startMinutes: 540, endMinutes: 900 },  // 6h → no meal, 1 rest
    { startMinutes: 600, endMinutes: 840 },  // 4h → no meal, 1 rest
  ];

  it("counts shifts that require a meal break and totals rest breaks", () => {
    const s = summarizeBreakRequirements(shifts);
    expect(s.totalShifts).toBe(3);
    expect(s.mealBreaksRequired).toBe(1);
    expect(s.restBreaksRequired).toBe(2 + 1 + 1);
  });

  it("handles an empty list", () => {
    expect(summarizeBreakRequirements([])).toEqual({
      totalShifts: 0,
      mealBreaksRequired: 0,
      restBreaksRequired: 0,
    });
  });
});
