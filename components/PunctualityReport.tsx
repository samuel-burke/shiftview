"use client";

import { fmtMinutes } from "../data/types";
import type { ArrivalStatus, PunctualitySummary } from "../lib/punctuality";

export type PunctualityRow = {
  employeeId: number;
  employeeName: string;
  scheduledStartMinutes: number;
  clockInMinutes: number | null;
  status: ArrivalStatus;
};

const STATUS_META: Record<ArrivalStatus, { label: string; cls: string }> = {
  on_time: { label: "On time", cls: "text-success-fg-strong bg-success/15" },
  late:    { label: "Late",    cls: "text-warning-fg-strong bg-warning/20" },
  absent:  { label: "No-show", cls: "text-danger-fg-strong bg-danger/20" },
};

export default function PunctualityReport({
  rows,
  summary,
}: {
  rows: PunctualityRow[];
  summary: PunctualitySummary;
}) {
  return (
    <div data-testid="punctuality" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase">Punctuality</div>
        <div data-testid="punctuality-rate" className="text-xs font-semibold text-fg-secondary">
          {summary.onTimeRate}% on time · {summary.absent} no-show{summary.absent === 1 ? "" : "s"}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-6 text-fg-muted text-sm">No shifts scheduled</div>
      ) : (
        rows.map((r) => {
          const meta = STATUS_META[r.status];
          return (
            <div
              key={r.employeeId}
              data-testid={`punctuality-row-${r.employeeId}`}
              className="flex items-center justify-between rounded-xl bg-card border border-line/60 px-3 py-2.5"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-fg">{r.employeeName}</span>
                <span className="text-[11px] text-fg-subtle">
                  Sched {fmtMinutes(r.scheduledStartMinutes)}
                  {r.clockInMinutes != null && ` · In ${fmtMinutes(r.clockInMinutes)}`}
                </span>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${meta.cls}`}>
                {meta.label}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
