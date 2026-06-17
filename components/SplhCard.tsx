"use client";

import { formatCentsPerHour } from "../lib/splh";

// Read-only sales-per-labor-hour card for a day. Presentational — the parent
// fetches /api/reports/splh.
export default function SplhCard({
  salesCents,
  laborMinutes,
  splhCents,
}: {
  salesCents: number;
  laborMinutes: number;
  splhCents: number | null;
}) {
  const laborHours = Math.round((laborMinutes / 60) * 10) / 10;
  return (
    <div data-testid="splh-card" className="rounded-2xl bg-card border border-slate-800/60 px-4 py-4">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2">
        Sales / Labor Hour
      </div>
      <div data-testid="splh-value" className="text-2xl font-bold text-emerald-300 tabular-nums">
        {formatCentsPerHour(splhCents)}
      </div>
      <div className="text-[11px] text-slate-500 mt-1">
        ${(salesCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sales · {laborHours}h labor
      </div>
    </div>
  );
}
