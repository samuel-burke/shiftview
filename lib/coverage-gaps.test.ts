import { describe, it, expect } from "vitest";
import { summarizeCoverageGaps, groupGapsByDate } from "./coverage-gaps";
import type { UnderstaffedRange } from "./coverage";

const ranges: UnderstaffedRange[] = [
  { date: "2026-06-15", startMinutes: 480, endMinutes: 600, shortfall: 2 }, // 120 min
  { date: "2026-06-15", startMinutes: 900, endMinutes: 960, shortfall: 1 }, // 60 min
  { date: "2026-06-17", startMinutes: 720, endMinutes: 900, shortfall: 3 }, // 180 min
];

describe("summarizeCoverageGaps", () => {
  it("totals gaps, gap minutes, distinct days, and the worst shortfall", () => {
    const s = summarizeCoverageGaps(ranges);
    expect(s.totalGaps).toBe(3);
    expect(s.totalGapMinutes).toBe(120 + 60 + 180);
    expect(s.daysWithGaps).toBe(2);
    expect(s.worstShortfall).toBe(3);
  });

  it("handles no gaps", () => {
    expect(summarizeCoverageGaps([])).toEqual({
      totalGaps: 0,
      totalGapMinutes: 0,
      daysWithGaps: 0,
      worstShortfall: 0,
    });
  });
});

describe("groupGapsByDate", () => {
  it("buckets ranges under each date, including empty days", () => {
    const days = groupGapsByDate(ranges, ["2026-06-15", "2026-06-16", "2026-06-17"]);
    expect(days).toHaveLength(3);
    expect(days[0]).toEqual({ date: "2026-06-15", gaps: [ranges[0], ranges[1]] });
    expect(days[1]).toEqual({ date: "2026-06-16", gaps: [] });
    expect(days[2]).toEqual({ date: "2026-06-17", gaps: [ranges[2]] });
  });
});
