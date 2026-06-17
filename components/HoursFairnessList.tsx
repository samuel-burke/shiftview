"use client";

// Read-only equity view of scheduled hours across the team. Presentational — the
// parent fetches /api/reports/hours-fairness.

import type { FairnessStatus } from "../lib/hours-fairness";

export type FairnessRowView = {
  employeeId: number;
  employeeName: string;
  totalHours: number;
  deviationMinutes: number;
  status: FairnessStatus;
};

export type FairnessSummaryView = {
  count: number;
  meanMinutes: number;
  spreadMinutes: number;
};

const STATUS_META: Record<FairnessStatus, { label: string; cls: string }> = {
  under: { label: "Under", cls: "text-sky-300 bg-sky-500/15" },
  fair:  { label: "Fair",  cls: "text-slate-400 bg-slate-700/40" },
  over:  { label: "Over",  cls: "text-amber-300 bg-amber-500/20" },
};

function fmtHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${m === 0 ? `${h}h` : `${h}h ${m}m`}`;
}

export default function HoursFairnessList({
  employees,
  summary,
}: {
  employees: FairnessRowView[];
  summary: FairnessSummaryView;
}) {
  return (
    <div data-testid="hours-fairness" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Hours Fairness</div>
        <div className="text-[11px] text-slate-500">
          avg {Math.round((summary.meanMinutes / 60) * 10) / 10}h · spread {Math.round((summary.spreadMinutes / 60) * 10) / 10}h
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No one scheduled this week</div>
      ) : (
        employees.map((e) => {
          const meta = STATUS_META[e.status];
          return (
            <div
              key={e.employeeId}
              data-testid={`fairness-row-${e.employeeId}`}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 border bg-card border-slate-800/60"
            >
              <span className="text-sm font-medium text-slate-100">{e.employeeName}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 tabular-nums">{fmtHours(e.deviationMinutes)}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${meta.cls}`}>
                  {meta.label}
                </span>
                <span className="text-sm font-semibold text-slate-300 tabular-nums w-12 text-right">{e.totalHours}h</span>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
