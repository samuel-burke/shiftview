// Which shift a person has on a day of the Week page, when live (published)
// shifts and drafts meet. Shared by the team grid, the phone day list and the
// coverage numbers, so all three agree.
//
// In Draft mode the page shows the week as it will be after publishing. A
// live shift always wins its cell: publishing keeps it and skips any draft for
// the same person and day (the API now refuses new ones; older ones may exist).

import type { Schedule } from "@/data/types";

export type ShiftSource = "live" | "draft";
export type SourcedShift = Schedule & { source?: ShiftSource };

export type WeekCell = {
  live: SourcedShift | null;
  draft: SourcedShift | null;
  // What the cell shows and counts.
  shown: SourcedShift | null;
};

export const cellKey = (employeeId: number, date: string) => `${employeeId}|${date.slice(0, 10)}`;

// Live mode ignores drafts; Draft mode lays them over the live shifts.
export function weekCells(shifts: SourcedShift[], mode: ShiftSource): Map<string, WeekCell> {
  const cells = new Map<string, WeekCell>();
  for (const s of shifts) {
    const isDraft = s.source === "draft";
    if (isDraft && mode !== "draft") continue;
    const key = cellKey(s.employeeId, s.date);
    const cell = cells.get(key) ?? { live: null, draft: null, shown: null };
    if (isDraft) cell.draft = s;
    else cell.live = s;
    cell.shown = cell.live ?? cell.draft;
    cells.set(key, cell);
  }
  return cells;
}

/** Drafts that won't publish: their person already has a live shift that day. */
export function clashingDrafts(live: Schedule[], drafts: Schedule[]): Schedule[] {
  const taken = new Set(live.map((s) => cellKey(s.employeeId, s.date)));
  return drafts.filter((d) => taken.has(cellKey(d.employeeId, d.date)));
}

/** The week after publishing: every live shift, plus the drafts that will publish. */
export function projectedShifts(live: SourcedShift[], drafts: SourcedShift[]): SourcedShift[] {
  const taken = new Set(live.map((s) => cellKey(s.employeeId, s.date)));
  return [...live, ...drafts.filter((d) => !taken.has(cellKey(d.employeeId, d.date)))];
}
