// The time card with break types, the meal rule and break attestation.
import { describe, it, expect } from "vitest";
import { computeTimecard, type TimecardPunchInput } from "./timecard";
import { DEFAULT_PUNCH_POLICY } from "./punch-policy";

const TZ = "America/New_York";
const DATE = "2026-01-15";
const est = (hh: number, mm: number) => `${DATE}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-05:00`;
let nextId = 1;
const punch = (punchType: TimecardPunchInput["punchType"], hh: number, mm: number, extra: Partial<TimecardPunchInput> = {}): TimecardPunchInput =>
  ({ id: nextId++, punchType, punchedAt: est(hh, mm), ...extra });

const REST = { id: 1, name: "Rest", paid: true, minMinutes: 10 };
const MEAL = { id: 2, name: "Meal", paid: false, minMinutes: 30 };

function card(punches: TimecardPunchInput[], extra: Partial<Parameters<typeof computeTimecard>[0]> = {}) {
  return computeTimecard({
    employeeId: 1, employeeName: "Ana", from: DATE, to: DATE, timezone: TZ,
    policy: DEFAULT_PUNCH_POLICY,
    schedules: [],
    punches, callouts: [], nowMs: Date.parse(`${DATE}T23:59:00-05:00`),
    breakTypes: [REST, MEAL],
    ...extra,
  });
}

describe("computeTimecard — paid and unpaid breaks", () => {
  it("pays a paid rest and deducts an unpaid meal in one shift", () => {
    const tc = card([
      punch("clock_in", 9, 0),
      punch("break_start", 11, 0, { breakTypeId: 1, breakPaid: true }),
      punch("break_end", 11, 10),
      punch("break_start", 13, 0, { breakTypeId: 2, breakPaid: false }),
      punch("break_end", 13, 30),
      punch("clock_out", 18, 0),
    ]);
    const day = tc.days[0];
    expect(day.workedHours).toBe(8.5);
    expect(day.breakHours).toBe(0.5);
    expect(day.breakCount).toBe(2);
    expect(day.hasIncomplete).toBe(false);
    expect(day.violations).toEqual([]);
    const starts = day.punches.filter((p) => p.punchType === "break_start");
    expect(starts.map((p) => [p.breakTypeName, p.breakPaid])).toEqual([["Rest", true], ["Meal", false]]);
  });

  it("deducts every break when the store has no break types, as before", () => {
    const tc = card([
      punch("clock_in", 9, 0), punch("break_start", 12, 0), punch("break_end", 12, 30), punch("clock_out", 18, 0),
    ], { breakTypes: [] });
    expect(tc.days[0].workedHours).toBe(8.5);
    expect(tc.days[0].breakHours).toBe(0.5);
    expect(tc.totalViolations).toBe(0);
  });

  it("flags a break shorter than its type's minimum", () => {
    const tc = card([
      punch("clock_in", 9, 0),
      punch("break_start", 13, 0, { breakTypeId: 2 }),
      punch("break_end", 13, 20),
      punch("clock_out", 18, 0),
    ]);
    expect(tc.days[0].violations).toEqual([
      expect.objectContaining({ type: "short_break", detail: "20 min meal (minimum 30 min)" }),
    ]);
  });

  it("doesn't flag a short break twice when the policy already does", () => {
    const tc = card([
      punch("clock_in", 9, 0),
      punch("break_start", 13, 0, { breakTypeId: 2 }),
      punch("break_end", 13, 15),
      punch("clock_out", 18, 0),
    ], { policy: { ...DEFAULT_PUNCH_POLICY, shortBreakEnabled: true, shortBreakMinutes: 20 } });
    expect(tc.violationCounts.short_break).toBe(1);
  });
});

describe("computeTimecard — the meal rule", () => {
  const rules = { mealRequiredAfterMinutes: 300, attestationEnabled: false };

  it("is off by default", () => {
    const tc = card([punch("clock_in", 9, 0), punch("clock_out", 18, 0)]);
    expect(tc.violationCounts.missed_meal).toBe(0);
  });

  it("doesn't flag a shift of exactly 5 hours", () => {
    const tc = card([punch("clock_in", 9, 0), punch("clock_out", 14, 0)], { breakRules: rules });
    expect(tc.totalViolations).toBe(0);
  });

  it("flags a missed meal on the clock-out of a longer shift", () => {
    const out = punch("clock_out", 14, 1);
    const tc = card([punch("clock_in", 9, 0), out], { breakRules: rules });
    expect(tc.days[0].violations).toEqual([expect.objectContaining({
      type: "missed_meal", punchId: out.id, detail: "Worked 5h 1m with no meal break (required after 5h)",
    })]);
    expect(tc.violationCounts.missed_meal).toBe(1);
  });

  it("accepts a meal that starts at exactly 5 hours, and flags one a minute later", () => {
    const onTime = card([
      punch("clock_in", 9, 0), punch("break_start", 14, 0, { breakTypeId: 2 }), punch("break_end", 14, 30), punch("clock_out", 18, 0),
    ], { breakRules: rules });
    expect(onTime.totalViolations).toBe(0);

    const late = card([
      punch("clock_in", 9, 0), punch("break_start", 14, 1, { breakTypeId: 2 }), punch("break_end", 14, 31), punch("clock_out", 18, 0),
    ], { breakRules: rules });
    expect(late.days[0].violations).toEqual([expect.objectContaining({ type: "late_meal", minutes: 301 })]);
  });

  it("doesn't take a paid rest for the meal", () => {
    const tc = card([
      punch("clock_in", 9, 0), punch("break_start", 12, 0, { breakTypeId: 1, breakPaid: true }), punch("break_end", 12, 45), punch("clock_out", 17, 0),
    ], { breakRules: rules });
    expect(tc.violationCounts.missed_meal).toBe(1);
  });
});

describe("computeTimecard — break attestation", () => {
  it("flags a clock-out where the employee said they couldn't take their breaks", () => {
    const out = punch("clock_out", 17, 0, { breaksAttested: false });
    const tc = card([punch("clock_in", 9, 0), out]);
    expect(tc.days[0].violations).toEqual([expect.objectContaining({ type: "breaks_not_taken", punchId: out.id })]);
    expect(tc.days[0].punches.find((p) => p.id === out.id)?.breaksAttested).toBe(false);
  });

  it("records a yes without a flag, and no answer as none", () => {
    const yes = card([punch("clock_in", 9, 0), punch("clock_out", 17, 0, { breaksAttested: true })]);
    expect(yes.totalViolations).toBe(0);
    expect(yes.days[0].punches[1].breaksAttested).toBe(true);
    const none = card([punch("clock_in", 9, 0), punch("clock_out", 17, 0)]);
    expect(none.days[0].punches[1].breaksAttested).toBeUndefined();
  });
});
