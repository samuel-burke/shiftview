import { describe, it, expect } from "vitest";
import { describeChange, isRealChange, summarizeChanges, type ScheduleChange } from "./schedule-changes";

const shift = (date: string, startMinutes: number, endMinutes: number, note: string | null = null) => ({ date, startMinutes, endMinutes, note });
const WEEK = "2026-10-17";

describe("isRealChange", () => {
  it("notices new times or a new note, and nothing else", () => {
    expect(isRealChange(shift(WEEK, 540, 1020), shift(WEEK, 540, 1020))).toBe(false);
    expect(isRealChange(shift(WEEK, 540, 1020), shift(WEEK, 600, 1020))).toBe(true);
    expect(isRealChange(shift(WEEK, 540, 1020), shift(WEEK, 540, 1020, "Truck"))).toBe(true);
    expect(isRealChange({ date: WEEK, startMinutes: 540, endMinutes: 1020 }, shift(WEEK, 540, 1020, null))).toBe(false);
  });
});

describe("describeChange", () => {
  it("says what happened on which day", () => {
    expect(describeChange({ kind: "added", shift: shift("2026-10-20", 540, 1020) })).toMatch(/^Tue, Oct 20: new shift 9(:00)?\s?AM – 5(:00)?\s?PM$/);
    expect(describeChange({ kind: "removed", shift: shift("2026-10-21", 540, 1020) })).toMatch(/^Wed, Oct 21: shift .* removed$/);
    expect(describeChange({ kind: "changed", before: shift("2026-10-22", 540, 1020), after: shift("2026-10-22", 600, 1080) })).toMatch(/^Thu, Oct 22: 9.* → 10.*$/);
    expect(describeChange({ kind: "changed", before: shift("2026-10-22", 540, 1020), after: shift("2026-10-22", 540, 1020, "x") })).toBe("Thu, Oct 22: note updated");
  });
});

describe("summarizeChanges", () => {
  it("says nothing when nothing changed", () => {
    expect(summarizeChanges(WEEK, [], true)).toBeNull();
  });

  it("keeps the familiar message for a week that's new to the person", () => {
    expect(summarizeChanges(WEEK, [{ kind: "added", shift: shift("2026-10-20", 540, 1020) }], false)).toEqual({
      title: "Schedule Published",
      body: `Your schedule for the week of ${WEEK} has been published`,
    });
  });

  it("lists the changes, by day, when the week was already published", () => {
    const changes: ScheduleChange[] = [
      { kind: "removed", shift: shift("2026-10-22", 540, 1020) },
      { kind: "added", shift: shift("2026-10-20", 540, 1020) },
    ];
    const out = summarizeChanges(WEEK, changes, true)!;
    expect(out.title).toBe("Schedule Updated");
    expect(out.body.indexOf("Oct 20")).toBeLessThan(out.body.indexOf("Oct 22"));
    expect(out.body).toMatch(/new shift.*; .*removed/);
  });

  it("caps a long list", () => {
    const changes: ScheduleChange[] = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].map((d) => ({
      kind: "removed" as const, shift: shift(d, 540, 1020),
    }));
    expect(summarizeChanges(WEEK, changes, true)!.body).toMatch(/and 2 more$/);
  });
});
