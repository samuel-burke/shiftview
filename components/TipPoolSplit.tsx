"use client";

import { formatCents } from "../lib/tip-pool";

// Read-only display of a tip-pool split (by hours). Presentational — the parent
// fetches /api/reports/tip-pool.

export type TipShareView = {
  employeeId: number;
  employeeName: string;
  minutes: number;
  cents: number;
};

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function TipPoolSplit({
  poolCents,
  shares,
}: {
  poolCents: number;
  shares: TipShareView[];
}) {
  return (
    <div data-testid="tip-pool" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Tip Pool</div>
        <div data-testid="tip-pool-total" className="text-sm font-bold text-slate-100">{formatCents(poolCents)}</div>
      </div>

      {shares.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No one scheduled to split tips</div>
      ) : (
        shares.map((s) => (
          <div
            key={s.employeeId}
            data-testid={`tip-share-${s.employeeId}`}
            className="flex items-center justify-between rounded-xl bg-card border border-slate-800/60 px-3 py-2.5"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium text-slate-100">{s.employeeName}</span>
              <span className="text-[11px] text-slate-500">{fmtHours(s.minutes)}</span>
            </span>
            <span className="text-sm font-semibold text-emerald-300 tabular-nums">{formatCents(s.cents)}</span>
          </div>
        ))
      )}
    </div>
  );
}
