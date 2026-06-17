// Pure aggregation over the understaffed ranges produced by
// findUnderstaffedFromCurves (lib/coverage.ts), for a week-level coverage-gap
// report. The per-slot gap detection already lives (and is tested) in
// lib/coverage.ts; this only summarizes and buckets the results.

import type { UnderstaffedRange } from "./coverage";

export type CoverageGapSummary = {
  totalGaps: number;
  totalGapMinutes: number;
  daysWithGaps: number;
  worstShortfall: number;
};

export function summarizeCoverageGaps(ranges: UnderstaffedRange[]): CoverageGapSummary {
  let totalGapMinutes = 0;
  let worstShortfall = 0;
  const days = new Set<string>();
  for (const r of ranges) {
    totalGapMinutes += r.endMinutes - r.startMinutes;
    worstShortfall = Math.max(worstShortfall, r.shortfall);
    days.add(r.date);
  }
  return {
    totalGaps: ranges.length,
    totalGapMinutes,
    daysWithGaps: days.size,
    worstShortfall,
  };
}

export type DayGaps = { date: string; gaps: UnderstaffedRange[] };

// Bucket ranges under each of the given dates (empty days included, order
// preserved) so the report can render a row per day.
export function groupGapsByDate(ranges: UnderstaffedRange[], dates: string[]): DayGaps[] {
  return dates.map((date) => ({
    date,
    gaps: ranges.filter((r) => r.date === date),
  }));
}
