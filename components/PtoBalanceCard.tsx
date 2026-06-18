"use client";

// Read-only PTO balance card. Presentational: the caller fetches
// /api/time-off/balance and passes the computed balance in.

import type { PtoBalance } from "../lib/pto-balance";

function dayLabel(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? "day" : "days"}`;
}

export default function PtoBalanceCard({
  balance,
  year,
  employeeName,
}: {
  balance: PtoBalance;
  year: number;
  employeeName?: string;
}) {
  const { tracked, allowanceDays, usedDays, remainingDays } = balance;
  const negative = remainingDays != null && remainingDays < 0;

  return (
    <div data-testid="pto-balance-card" className="rounded-2xl bg-card border border-slate-800/60 px-4 py-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">
          PTO Balance{employeeName ? ` · ${employeeName}` : ""}
        </div>
        <div className="text-[11px] text-slate-500">{year}</div>
      </div>

      {!tracked ? (
        <div data-testid="pto-untracked" className="text-sm text-slate-300">
          <span className="font-semibold text-slate-100">{dayLabel(usedDays)}</span> taken
          <span className="block text-[11px] text-slate-500 mt-0.5">No allowance set — PTO isn’t tracked</span>
        </div>
      ) : (
        <div className="flex items-end justify-between">
          <div>
            <div
              data-testid="pto-remaining"
              className={`text-2xl font-bold tabular-nums ${negative ? "text-red-400" : "text-emerald-300"}`}
            >
              {dayLabel(remainingDays as number)}
            </div>
            <div className="text-[11px] text-slate-500">remaining</div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>{dayLabel(usedDays)} used</div>
            <div>of {dayLabel(allowanceDays as number)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
