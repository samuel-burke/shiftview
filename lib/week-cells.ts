// Which shift a person has on a day of the Week page, when live (published)
// shifts and drafts meet. Shared by the team grid, the phone day list and the
// coverage numbers, so all three agree.
//
// In Draft mode the page shows the week as it will be after publishing. A
// draft can change or remove the live shift it names (replacesScheduleId);
// then the cell shows the draft (or nothing, for a removal). Any other draft
// on a day with a live shift loses: publishing keeps the live shift and skips
// the draft (the API refuses new ones; older ones may exist).

import type { Schedule } from "@/data/types";

export type ShiftSource = "live" | "draft";
export type SourcedShift = Schedule & { source?: ShiftSource };

export type WeekCell = {
  live: SourcedShift | null;
  draft: SourcedShift | null;
  // The draft changes ("edit") or removes ("remove") the live shift.
  change: "edit" | "remove" | null;
  // What the cell shows and counts.
  shown: SourcedShift | null;
};

export const cellKey = (employeeId: number, date: string) => `${employeeId}|${date.slice(0, 10)}`;

/** Whether `draft` changes or removes `live`. */
export const changesLive = (draft: Schedule | null, live: Schedule | null) =>
  !!draft && !!live && draft.replacesScheduleId != null && draft.replacesScheduleId === live.id;

// Live mode ignores drafts; Draft mode lays them over the live shifts.
export function weekCells(shifts: SourcedShift[], mode: ShiftSource): Map<string, WeekCell> {
  const cells = new Map<string, WeekCell>();
  for (const s of shifts) {
    const isDraft = s.source === "draft";
    if (isDraft && mode !== "draft") continue;
    const key = cellKey(s.employeeId, s.date);
    const cell = cells.get(key) ?? { live: null, draft: null, change: null, shown: null };
    if (isDraft) cell.draft = s;
    else cell.live = s;
    cell.change = changesLive(cell.draft, cell.live) ? (cell.draft!.removes ? "remove" : "edit") : null;
    cell.shown = cell.change === "remove" ? null : cell.change === "edit" ? cell.draft : cell.live ?? cell.draft;
    cells.set(key, cell);
  }
  return cells;
}

/** Drafts that won't publish: their person already has a live shift that day the draft doesn't change. */
export function clashingDrafts(live: Schedule[], drafts: Schedule[]): Schedule[] {
  const taken = new Set(live.map((s) => cellKey(s.employeeId, s.date)));
  return drafts.filter((d) => d.replacesScheduleId == null && taken.has(cellKey(d.employeeId, d.date)));
}

/** The week after publishing: live shifts as the drafts change them, plus the new drafts that will publish. */
export function projectedShifts(live: SourcedShift[], drafts: SourcedShift[]): SourcedShift[] {
  const liveIds = new Set(live.map((s) => s.id));
  const changes = drafts.filter((d) => d.replacesScheduleId != null && liveIds.has(d.replacesScheduleId));
  const superseded = new Set(changes.map((d) => d.replacesScheduleId));
  const kept = live.filter((s) => !superseded.has(s.id));
  const taken = new Set(kept.map((s) => cellKey(s.employeeId, s.date)));
  const added = drafts.filter((d) => d.replacesScheduleId == null && !taken.has(cellKey(d.employeeId, d.date)));
  return [...kept, ...changes.filter((d) => !d.removes), ...added];
}

/** How many drafts publishing will act on: changes to live shifts plus new shifts that don't clash. */
export function publishableCount(live: Schedule[], drafts: Schedule[]): number {
  return drafts.length - clashingDrafts(live, drafts).length;
}
