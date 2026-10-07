import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULING_RULES,
  applySchedulingRulesPatch,
  parseSchedulingRules,
  resolveEmployeeLimits,
  validateEmployeeSchedulingPatch,
} from "./scheduling-rules";

describe("parseSchedulingRules", () => {
  it("returns defaults for an empty map", () => {
    expect(parseSchedulingRules({})).toEqual(DEFAULT_SCHEDULING_RULES);
  });

  it("parses numbers and enums from the settings map", () => {
    const rules = parseSchedulingRules({
      sched_min_shift_minutes: "180",
      sched_max_shift_minutes: "600",
      sched_start_granularity_minutes: "15",
      sched_min_rest_minutes: "660",
      sched_max_consecutive_days: "5",
      sched_overtime_policy: "when_needed",
      sched_pending_time_off: "ignore",
      sched_ft_min_hours: "37.5",
      sched_pt_max_hours: "24",
    });
    expect(rules).toMatchObject({
      minShiftMinutes: 180,
      maxShiftMinutes: 600,
      startGranularityMinutes: 15,
      minRestMinutes: 660,
      maxConsecutiveDays: 5,
      overtimePolicy: "when_needed",
      pendingTimeOff: "ignore",
      fullTimeMinHours: 37.5,
      partTimeMaxHours: 24,
    });
  });

  it("falls back to defaults for malformed values", () => {
    const rules = parseSchedulingRules({
      sched_min_shift_minutes: "abc",
      sched_start_granularity_minutes: "20",
      sched_max_consecutive_days: "9",
      sched_overtime_policy: "sometimes",
      sched_ft_max_hours: "40.25",
    });
    expect(rules.minShiftMinutes).toBe(DEFAULT_SCHEDULING_RULES.minShiftMinutes);
    expect(rules.startGranularityMinutes).toBe(DEFAULT_SCHEDULING_RULES.startGranularityMinutes);
    expect(rules.maxConsecutiveDays).toBe(DEFAULT_SCHEDULING_RULES.maxConsecutiveDays);
    expect(rules.overtimePolicy).toBe("never");
    expect(rules.fullTimeMaxHours).toBe(DEFAULT_SCHEDULING_RULES.fullTimeMaxHours);
  });

  it("resets a min/max pair that is out of order", () => {
    const rules = parseSchedulingRules({ sched_min_shift_minutes: "600", sched_max_shift_minutes: "300" });
    expect(rules.minShiftMinutes).toBe(DEFAULT_SCHEDULING_RULES.minShiftMinutes);
    expect(rules.maxShiftMinutes).toBe(DEFAULT_SCHEDULING_RULES.maxShiftMinutes);
  });
});

describe("applySchedulingRulesPatch", () => {
  it("merges a valid patch and returns rows for the fields it set", () => {
    const result = applySchedulingRulesPatch(
      { maxShiftMinutes: 600, overtimePolicy: "when_needed", partTimeMaxHours: 25.5 },
      DEFAULT_SCHEDULING_RULES
    );
    if (result.error !== null) throw new Error(result.error);
    expect(result.rules.maxShiftMinutes).toBe(600);
    expect(result.rules.minShiftMinutes).toBe(DEFAULT_SCHEDULING_RULES.minShiftMinutes);
    expect(result.rows).toEqual([
      { key: "sched_max_shift_minutes", value: "600" },
      { key: "sched_pt_max_hours", value: "25.5" },
      { key: "sched_overtime_policy", value: "when_needed" },
    ]);
  });

  it.each([
    [{ minShiftMinutes: 50 }, /minShiftMinutes/],
    [{ maxShiftMinutes: 1000 }, /maxShiftMinutes/],
    [{ minShiftMinutes: 250 }, /multiple of 15/],
    [{ startGranularityMinutes: 45 }, /15, 30 or 60/],
    [{ maxConsecutiveDays: 0 }, /maxConsecutiveDays/],
    [{ fullTimeMaxHours: 40.2 }, /half hour/],
    [{ partTimeMaxHours: "29" }, /partTimeMaxHours/],
    [{ overtimePolicy: "always" }, /overtimePolicy/],
  ])("rejects %j", (patch, message) => {
    const result = applySchedulingRulesPatch(patch, DEFAULT_SCHEDULING_RULES);
    expect(result.error).toMatch(message);
  });

  it("rejects a patch that puts a minimum above the stored maximum", () => {
    const result = applySchedulingRulesPatch({ minShiftMinutes: 540 }, DEFAULT_SCHEDULING_RULES);
    expect(result.error).toBe("minShiftMinutes cannot exceed maxShiftMinutes");
  });

  it("accepts a patch that moves both ends of a range together", () => {
    const result = applySchedulingRulesPatch({ fullTimeMinHours: 45, fullTimeMaxHours: 50 }, DEFAULT_SCHEDULING_RULES);
    expect(result.error).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(applySchedulingRulesPatch(null, DEFAULT_SCHEDULING_RULES).error).toMatch(/object/);
    expect(applySchedulingRulesPatch([1], DEFAULT_SCHEDULING_RULES).error).toMatch(/object/);
  });
});

describe("resolveEmployeeLimits", () => {
  it("uses the full-time defaults for a full-timer without limits", () => {
    expect(resolveEmployeeLimits({ employmentType: "full_time" }, DEFAULT_SCHEDULING_RULES)).toEqual({
      type: "full_time",
      typeSet: true,
      minMinutes: 32 * 60,
      maxMinutes: 40 * 60,
      maxDays: 5,
    });
  });

  it("treats an unset type as part-time and flags it", () => {
    expect(resolveEmployeeLimits({}, DEFAULT_SCHEDULING_RULES)).toEqual({
      type: "part_time",
      typeSet: false,
      minMinutes: 0,
      maxMinutes: 29 * 60,
      maxDays: 5,
    });
  });

  it("prefers the employee's own limits", () => {
    const limits = resolveEmployeeLimits(
      { employmentType: "part_time", minWeeklyHours: 12, maxWeeklyHours: 20.5, maxDaysPerWeek: 3 },
      DEFAULT_SCHEDULING_RULES
    );
    expect(limits).toMatchObject({ minMinutes: 720, maxMinutes: 1230, maxDays: 3 });
  });

  it("never lets the minimum exceed a personal maximum", () => {
    const limits = resolveEmployeeLimits({ employmentType: "full_time", maxWeeklyHours: 20 }, DEFAULT_SCHEDULING_RULES);
    expect(limits.minMinutes).toBe(20 * 60);
    expect(limits.maxMinutes).toBe(20 * 60);
  });
});

describe("validateEmployeeSchedulingPatch", () => {
  it("maps fields to their columns", () => {
    const result = validateEmployeeSchedulingPatch(
      { employmentType: "full_time", minWeeklyHours: 35, maxWeeklyHours: 40, maxDaysPerWeek: 5 },
      {}
    );
    expect(result).toEqual({
      updates: { employment_type: "full_time", min_weekly_hours: 35, max_weekly_hours: 40, max_days_per_week: 5 },
      error: null,
    });
  });

  it("allows null to clear a field back to the org default", () => {
    const result = validateEmployeeSchedulingPatch({ employmentType: null, maxWeeklyHours: null }, { maxWeeklyHours: 30 });
    expect(result).toEqual({ updates: { employment_type: null, max_weekly_hours: null }, error: null });
  });

  it("ignores fields it doesn't own", () => {
    expect(validateEmployeeSchedulingPatch({ name: "x" }, {})).toEqual({ updates: {}, error: null });
  });

  it.each([
    [{ employmentType: "contractor" }, /employmentType/],
    [{ minWeeklyHours: -1 }, /minWeeklyHours/],
    [{ maxWeeklyHours: 81 }, /maxWeeklyHours/],
    [{ maxWeeklyHours: 20.3 }, /maxWeeklyHours/],
    [{ maxDaysPerWeek: 8 }, /maxDaysPerWeek/],
    [{ maxDaysPerWeek: 2.5 }, /maxDaysPerWeek/],
  ])("rejects %j", (patch, message) => {
    expect(validateEmployeeSchedulingPatch(patch, {}).error).toMatch(message);
  });

  it("checks a one-sided change against the stored value", () => {
    expect(validateEmployeeSchedulingPatch({ minWeeklyHours: 30 }, { maxWeeklyHours: 25 }).error)
      .toBe("minWeeklyHours cannot exceed maxWeeklyHours");
    expect(validateEmployeeSchedulingPatch({ minWeeklyHours: 20 }, { maxWeeklyHours: 25 }).error).toBeNull();
  });
});
