"use client";

// Read-only list of the day's shifts with their legally-required breaks, so a
// manager can plan break coverage. Presentational — the parent fetches
// /api/reports/break-requirements.

import { fmtMinutes } from "../data/types";

export type BreakShift = {
  scheduleId: number;
  employeeName: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  mealBreakRequired: boolean;
  restBreaks: number;
};

export type BreakSummary = {
  totalShifts: number;
  mealBreaksRequired: number;
  restBreaksRequired: number;
};

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function BreakRequirementsList({
  shifts,
  summary,
}: {
  shifts: BreakShift[];
  summary: BreakSummary;
}) {
  return (
    <div data-testid="break-requirements" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">
          Break Requirements
        </div>
        <div className="text-xs font-semibold text-amber-400">
          {summary.mealBreaksRequired} meal {summary.mealBreaksRequired === 1 ? "break" : "breaks"}
        </div>
      </div>

      {shifts.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No shifts scheduled</div>
      ) : (
        shifts.map((s) => (
          <div
            key={s.scheduleId}
            data-testid={`break-shift-${s.scheduleId}`}
            className={`flex items-center justify-between rounded-xl px-3 py-2.5 border ${
              s.mealBreakRequired ? "bg-amber-500/10 border-amber-500/30" : "bg-card border-slate-800/60"
            }`}
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-100">{s.employeeName}</span>
              <span className="text-[11px] text-slate-500">
                {fmtMinutes(s.startMinutes)}–{fmtMinutes(s.endMinutes)} · {fmtDuration(s.durationMinutes)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {s.mealBreakRequired && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/20 rounded-full px-2 py-0.5">
                  Meal break
                </span>
              )}
              {s.restBreaks > 0 && (
                <span className="text-[10px] font-semibold text-slate-400">
                  {s.restBreaks} rest
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
