import { describe, it, expect } from "vitest";
import {
  DEMO_AVAILABILITY,
  DEMO_COVERAGE_DEFAULTS,
  DEMO_COVERAGE_PROFILES,
  DEMO_EMPLOYEES,
  DEMO_EMPLOYMENT,
  DEMO_PREFERENCES,
  DEMO_STORE_HOURS,
  EMPLOYEE_PATTERNS,
} from "./demo-fixtures";
import { DEFAULT_SCHEDULING_RULES, resolveEmployeeLimits, validateEmployeeSchedulingPatch } from "@/lib/scheduling-rules";
import { validatePreferencesInput } from "@/lib/preferences";
import { fitsAvailability } from "@/lib/availability-rules";
import { SLOT_MINUTES, targetAt } from "@/lib/coverage";

// The demo seed writes these straight to the database; a bad value would only
// surface as a failed nightly reset. Hold them to the API's own validation.
describe("demo scheduling fixtures", () => {
  const ids = new Set(DEMO_EMPLOYEES.map((e) => e.id));

  it("only describe demo employees", () => {
    for (const id of [...Object.keys(DEMO_EMPLOYMENT), ...Object.keys(DEMO_PREFERENCES)]) {
      expect(ids.has(Number(id))).toBe(true);
    }
  });

  it.each(Object.entries(DEMO_EMPLOYMENT))("employment for employee %s is valid", (_, e) => {
    const result = validateEmployeeSchedulingPatch(
      { employmentType: e.type, minWeeklyHours: e.minHours ?? null, maxWeeklyHours: e.maxHours ?? null, maxDaysPerWeek: e.maxDays ?? null },
      {}
    );
    expect(result.error).toBeNull();
    expect(e.payRate).toBeGreaterThan(0);
  });

  it.each(Object.entries(DEMO_PREFERENCES))("preferences for employee %s are valid", (_, p) => {
    const result = validatePreferencesInput({
      preferredShiftTypes: p.shiftTypes,
      preferredDays: p.preferredDays,
      avoidDays: p.avoidDays,
      desiredWeeklyHours: p.desiredHours ?? null,
      note: p.note ?? null,
    });
    expect(result.error).toBeNull();
  });
});

// The published week is what visitors see in the live demo and on the
// marketing pages, so it has to read like a real schedule for this store.
describe("demo weekly pattern", () => {
  const rules = DEFAULT_SCHEDULING_RULES;
  const profiles = new Map(DEMO_COVERAGE_PROFILES.map((p) => [p.id, p.blocks]));
  const shiftsOn = (dow: number) =>
    DEMO_EMPLOYEES.flatMap((e) => {
      const s = EMPLOYEE_PATTERNS[e.id]?.[dow];
      return s ? [{ employeeId: e.id, start: s[0], end: s[1] }] : [];
    });

  it.each([0, 1, 2, 3, 4, 5, 6])("staffs day %i exactly to its coverage target, inside store hours", (dow) => {
    const blocks = profiles.get(DEMO_COVERAGE_DEFAULTS[dow])!;
    const shifts = shiftsOn(dow);
    for (const s of shifts) {
      expect(s.start).toBeGreaterThanOrEqual(DEMO_STORE_HOURS[dow].open);
      expect(s.end).toBeLessThanOrEqual(DEMO_STORE_HOURS[dow].close);
    }
    for (let t = 0; t < 1440; t += SLOT_MINUTES) {
      const working = shifts.filter((s) => t >= s.start && t < s.end).length;
      expect(working, `${dow} at minute ${t}`).toBe(targetAt(blocks, t));
    }
  });

  it.each(DEMO_EMPLOYEES.map((e) => [e.name, e.id] as const))("%s works within their availability and limits", (_, id) => {
    const week = EMPLOYEE_PATTERNS[id] ?? [];
    const job = DEMO_EMPLOYMENT[id];
    const limits = resolveEmployeeLimits(
      { employmentType: job.type, minWeeklyHours: job.minHours ?? null, maxWeeklyHours: job.maxHours ?? null, maxDaysPerWeek: job.maxDays ?? null },
      rules
    );
    const minutes = week.reduce((sum, s) => sum + (s ? s[1] - s[0] : 0), 0);
    expect(minutes).toBeGreaterThanOrEqual(limits.minMinutes);
    expect(minutes).toBeLessThanOrEqual(limits.maxMinutes);
    expect(week.filter(Boolean).length).toBeLessThanOrEqual(limits.maxDays);

    week.forEach((s, dow) => {
      if (!s) return;
      expect(s[1] - s[0]).toBeGreaterThanOrEqual(rules.minShiftMinutes);
      expect(s[1] - s[0]).toBeLessThanOrEqual(rules.maxShiftMinutes);
      const rule = DEMO_AVAILABILITY[id]?.find((a) => a.dayOfWeek === dow);
      expect(fitsAvailability(rule, s[0], s[1]), `day ${dow}`).toBe(true);
      // Rest before the next day's shift, wrapping Saturday into Sunday.
      const next = week[(dow + 1) % 7];
      if (next) expect(1440 - s[1] + next[0]).toBeGreaterThanOrEqual(rules.minRestMinutes);
    });
  });
});
