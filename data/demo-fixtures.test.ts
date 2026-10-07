import { describe, it, expect } from "vitest";
import { DEMO_EMPLOYEES, DEMO_EMPLOYMENT, DEMO_PREFERENCES } from "./demo-fixtures";
import { validateEmployeeSchedulingPatch } from "@/lib/scheduling-rules";
import { validatePreferencesInput } from "@/lib/preferences";

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
