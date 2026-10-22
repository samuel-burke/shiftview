import { describe, it, expect } from "vitest";
import { cellKey, clashingDrafts, projectedShifts, publishableCount, weekCells, type SourcedShift } from "./week-cells";

const live = (id: number, employeeId: number, date: string, start = 540, end = 1020): SourcedShift =>
  ({ id, employeeId, date, startMinutes: start, endMinutes: end, source: "live" });
const draft = (id: number, employeeId: number, date: string, extra: Partial<SourcedShift> = {}, start = 600, end = 1080): SourcedShift =>
  ({ id, employeeId, date, startMinutes: start, endMinutes: end, source: "draft", ...extra });

const D = "2026-10-20";

describe("weekCells", () => {
  it("shows a change draft in place of the live shift it changes", () => {
    const cell = weekCells([live(1, 5, D), draft(9, 5, D, { replacesScheduleId: 1 })], "draft").get(cellKey(5, D))!;
    expect(cell.change).toBe("edit");
    expect(cell.shown?.id).toBe(9);
  });

  it("shows nothing for a removal, but keeps both sides", () => {
    const cell = weekCells([draft(9, 5, D, { replacesScheduleId: 1, removes: true }), live(1, 5, D)], "draft").get(cellKey(5, D))!;
    expect(cell.change).toBe("remove");
    expect(cell.shown).toBeNull();
    expect(cell.live?.id).toBe(1);
    expect(cell.draft?.id).toBe(9);
  });

  it("lets the live shift win over an unrelated draft", () => {
    const cell = weekCells([live(1, 5, D), draft(9, 5, D)], "draft").get(cellKey(5, D))!;
    expect(cell.change).toBeNull();
    expect(cell.shown?.id).toBe(1);
  });

  it("ignores drafts in Live mode", () => {
    const cell = weekCells([live(1, 5, D), draft(9, 5, D, { replacesScheduleId: 1, removes: true })], "live").get(cellKey(5, D))!;
    expect(cell.shown?.id).toBe(1);
    expect(cell.change).toBeNull();
  });
});

describe("clashingDrafts / projectedShifts / publishableCount", () => {
  const liveShifts = [live(1, 5, D), live(2, 6, D), live(3, 7, D)];
  const drafts = [
    draft(10, 5, D, { replacesScheduleId: 1 }),                 // change
    draft(11, 6, D, { replacesScheduleId: 2, removes: true }),  // removal
    draft(12, 7, D),                                            // clash
    draft(13, 8, D),                                            // new
  ];

  it("doesn't count changes as clashes", () => {
    expect(clashingDrafts(liveShifts, drafts).map((d) => d.id)).toEqual([12]);
    expect(publishableCount(liveShifts, drafts)).toBe(3);
  });

  it("projects the week as it will be after publishing", () => {
    const ids = projectedShifts(liveShifts, drafts).map((s) => s.id).sort((a, b) => a - b);
    expect(ids).toEqual([3, 10, 13]);
  });

  it("ignores a change whose live shift is gone", () => {
    expect(projectedShifts([], [draft(10, 5, D, { replacesScheduleId: 1 })])).toEqual([]);
  });
});
