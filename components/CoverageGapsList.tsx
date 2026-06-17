"use client";

// Read-only week coverage-gap report. Presentational — the parent fetches
// /api/reports/coverage-gaps and passes the per-day buckets + summary in.

import { fmtMinutes } from "../data/types";
import type { UnderstaffedRange } from "../lib/coverage";

export type DayGaps = { date: string; gaps: UnderstaffedRange[] };
export type CoverageGapSummary = {
  totalGaps: number;
  totalGapMinutes: number;
  daysWithGaps: number;
  worstShortfall: number;
};

function weekday(date: string): string {
  try {
    return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

export default function CoverageGapsList({
  days,
  summary,
}: {
  days: DayGaps[];
  summary: CoverageGapSummary;
}) {
  if (summary.totalGaps === 0) {
    return (
      <div data-testid="coverage-gaps" className="flex flex-col gap-2">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Coverage Gaps</div>
        <div data-testid="coverage-gaps-clear" className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-4 text-center text-sm text-emerald-300">
          Fully covered — no gaps this week
        </div>
      </div>
    );
  }

  return (
    <div data-testid="coverage-gaps" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Coverage Gaps</div>
        <div className="text-xs font-semibold text-red-400">
          {summary.daysWithGaps} {summary.daysWithGaps === 1 ? "day" : "days"} short
        </div>
      </div>

      {days
        .filter((d) => d.gaps.length > 0)
        .map((d) => (
          <div key={d.date} data-testid={`coverage-day-${d.date}`} className="rounded-xl bg-card border border-slate-800/60 px-3 py-2.5">
            <div className="text-sm font-semibold text-slate-100 mb-1">{weekday(d.date)}</div>
            <div className="flex flex-col gap-1">
              {d.gaps.map((g, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {fmtMinutes(g.startMinutes)}–{fmtMinutes(g.endMinutes)}
                  </span>
                  <span className="font-semibold text-red-300">
                    short {g.shortfall}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
