// Hour-by-hour coverage for a week: how far scheduled headcount is from the
// coverage target in each hour of each day, for the Week page's heatmap.

import { SLOT_MINUTES, targetAt, type CoverageBlock } from "@/lib/coverage";
import { headcountAt, type ShiftSpan } from "@/lib/draft-metrics";

export type HeatKind = "empty" | "met" | "short" | "over";

export type HeatCell = {
  startMinutes: number; // the hour's start
  kind: HeatKind;
  // Scheduled minus target at the hour's worst 15 minutes: the biggest
  // shortfall if any, else the biggest excess. 0 when met or empty.
  diff: number;
  scheduled: number;
  target: number;
};

export type HeatRow = { date: string; cells: HeatCell[] };

const HOUR = 60;
const SLOTS_PER_HOUR = HOUR / SLOT_MINUTES;

export function coverageHeatmap(
  shifts: ShiftSpan[],
  dates: string[],
  curves: Record<string, CoverageBlock[]>
): { hours: number[]; rows: HeatRow[] } {
  // Headcount and target per 15-minute slot, per day.
  const grid = dates.map((date) =>
    Array.from({ length: 1440 / SLOT_MINUTES }, (_, s) => {
      const minute = s * SLOT_MINUTES;
      return { target: targetAt(curves[date] ?? [], minute), scheduled: headcountAt(shifts, date, minute) };
    })
  );

  // Columns span every hour anyone is needed or scheduled, across the week.
  let first = Infinity;
  let last = -Infinity;
  for (const day of grid) {
    day.forEach((slot, s) => {
      if (slot.target > 0 || slot.scheduled > 0) {
        first = Math.min(first, s);
        last = Math.max(last, s);
      }
    });
  }
  if (first === Infinity) return { hours: [], rows: dates.map((date) => ({ date, cells: [] })) };
  const firstHour = Math.floor(first / SLOTS_PER_HOUR);
  const lastHour = Math.floor(last / SLOTS_PER_HOUR);
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => (firstHour + i) * HOUR);

  const rows = dates.map((date, d) => ({
    date,
    cells: hours.map((startMinutes): HeatCell => {
      const slots = grid[d].slice(startMinutes / SLOT_MINUTES, startMinutes / SLOT_MINUTES + SLOTS_PER_HOUR);
      const active = slots.filter((s) => s.target > 0 || s.scheduled > 0);
      if (active.length === 0) return { startMinutes, kind: "empty", diff: 0, scheduled: 0, target: 0 };
      const worstShort = active.reduce((a, b) => (b.scheduled - b.target < a.scheduled - a.target ? b : a));
      if (worstShort.scheduled < worstShort.target)
        return { startMinutes, kind: "short", diff: worstShort.scheduled - worstShort.target, ...worstShort };
      const worstOver = active.reduce((a, b) => (b.scheduled - b.target > a.scheduled - a.target ? b : a));
      if (worstOver.scheduled > worstOver.target)
        return { startMinutes, kind: "over", diff: worstOver.scheduled - worstOver.target, ...worstOver };
      return { startMinutes, kind: "met", diff: 0, ...worstOver };
    }),
  }));
  return { hours, rows };
}

export type HeatRange = { kind: "short" | "over"; diff: number; startMinutes: number; endMinutes: number };

// A day's off-target hours, merged into runs of the same kind and size, e.g.
// 9 AM–1 PM short 2: the heatmap's list view.
export function heatRanges(row: HeatRow): HeatRange[] {
  const ranges: HeatRange[] = [];
  for (const cell of row.cells) {
    if (cell.kind !== "short" && cell.kind !== "over") continue;
    const last = ranges[ranges.length - 1];
    if (last && last.kind === cell.kind && last.diff === cell.diff && last.endMinutes === cell.startMinutes) {
      last.endMinutes += HOUR;
    } else {
      ranges.push({ kind: cell.kind, diff: cell.diff, startMinutes: cell.startMinutes, endMinutes: cell.startMinutes + HOUR });
    }
  }
  return ranges;
}
