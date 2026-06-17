"use client";

import type { TillStatus } from "../lib/till";

export type TillCount = {
  id: number;
  counterName: string;
  type: "open" | "close";
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  status: TillStatus;
  note?: string | null;
};

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

const STATUS_META: Record<TillStatus, string> = {
  balanced: "text-emerald-300 bg-emerald-500/15",
  over:     "text-sky-300 bg-sky-500/15",
  short:    "text-red-300 bg-red-500/20",
};

// Read-only list of a day's till counts with over/short variance. Presentational
// — the parent fetches /api/till-counts.
export default function TillCountList({ counts }: { counts: TillCount[] }) {
  return (
    <div data-testid="till-counts" className="flex flex-col gap-2">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Cash Drawer</div>

      {counts.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No drawer counts today</div>
      ) : (
        counts.map((c) => (
          <div
            key={c.id}
            data-testid={`till-count-${c.id}`}
            className="flex items-center justify-between rounded-xl bg-card border border-slate-800/60 px-3 py-2.5"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-100 capitalize">
                {c.type} · {c.counterName}
              </span>
              <span className="text-[11px] text-slate-500">
                counted {usd(c.countedCents)} / expected {usd(c.expectedCents)}
              </span>
            </div>
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-slate-300">{usd(c.varianceCents)}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_META[c.status]}`}>
                {c.status}
              </span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
