"use client";

// Read-only youth-labor compliance report for a day. Presentational — the parent
// fetches /api/reports/minor-compliance.

import { fmtMinutes } from "../data/types";

export type MinorViolation = {
  scheduleId: number;
  employeeId: number;
  employeeName: string;
  age: number;
  startMinutes: number;
  endMinutes: number;
  issues: string[];
};

export default function MinorComplianceList({
  violations,
}: {
  violations: MinorViolation[];
}) {
  return (
    <div data-testid="minor-compliance" className="flex flex-col gap-2">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">
        Minor Labor Compliance
      </div>

      {violations.length === 0 ? (
        <div data-testid="minor-compliance-clear" className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-4 text-center text-sm text-emerald-300">
          No youth-labor issues
        </div>
      ) : (
        violations.map((v) => (
          <div
            key={v.scheduleId}
            data-testid={`minor-violation-${v.scheduleId}`}
            className="rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">
                {v.employeeName} <span className="text-[11px] font-normal text-slate-400">(age {v.age})</span>
              </span>
              <span className="text-[11px] text-slate-400">
                {fmtMinutes(v.startMinutes)}–{fmtMinutes(v.endMinutes)}
              </span>
            </div>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {v.issues.map((issue, i) => (
                <li key={i} className="text-[10px] font-bold uppercase tracking-wide text-red-300 bg-red-500/20 rounded-full px-2 py-0.5">
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
