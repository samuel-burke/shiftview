"use client";

import { useMemo, useState } from "react";
import { fmtMinutes } from "../data/types";
import type { CoverageBlock } from "../lib/coverage";
import { coverageHeatmap, type HeatCell } from "../lib/coverage-heatmap";
import { dayOfWeek, type ShiftSpan } from "../lib/draft-metrics";

// The week at a glance: one row per day, one cell per hour, colored by how far
// scheduled headcount is from the coverage target (diverging: red = short,
// gray = met, blue = over; deeper = further off). Hover, tap or arrow keys show
// the hour's numbers in the readout below.

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function cellColor(cell: HeatCell): string {
  if (cell.kind === "met") return "var(--color-cov-met)";
  if (cell.kind === "empty") return "transparent";
  const step = Math.min(3, Math.abs(cell.diff));
  return `var(--color-cov-${cell.kind}-${step})`;
}

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const suffix = h >= 12 ? "p" : "a";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

function describe(date: string, cell: HeatCell): string {
  const when = `${DAY_NAMES[dayOfWeek(date)]} ${fmtMinutes(cell.startMinutes)}–${fmtMinutes(cell.startMinutes + 60)}`;
  if (cell.kind === "empty") return `${when}: no one needed`;
  const counts = `${cell.scheduled} scheduled, ${cell.target} needed`;
  if (cell.kind === "met") return `${when}: ${counts}, target met`;
  return `${when}: ${counts}, ${cell.kind} by ${Math.abs(cell.diff)}`;
}

export default function WeekCoverageHeatmap({
  shifts,
  dates,
  curves,
}: {
  shifts: ShiftSpan[];
  dates: string[];
  curves: Record<string, CoverageBlock[]>;
}) {
  const { hours, rows } = useMemo(() => coverageHeatmap(shifts, dates, curves), [shifts, dates, curves]);
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);

  const totals = useMemo(() => {
    let short = 0, over = 0;
    for (const r of rows) for (const c of r.cells) {
      if (c.kind === "short") short++;
      if (c.kind === "over") over++;
    }
    return { short, over };
  }, [rows]);

  if (hours.length === 0) {
    return (
      <section data-testid="coverage-heatmap" className="mb-4">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">Coverage by Hour</div>
        <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-6 text-center text-sm text-slate-500">
          No coverage targets or shifts this week
        </div>
      </section>
    );
  }

  const activeCell = active ? rows[active.row]?.cells[active.col] : null;
  const labelEvery = hours.length > 12 ? 3 : 1;
  const cellId = (r: number, c: number) => `heat-${r}-${c}`;

  function move(e: React.KeyboardEvent) {
    const cur = active ?? { row: 0, col: 0 };
    const next = { ...cur };
    if (e.key === "ArrowRight") next.col = Math.min(hours.length - 1, cur.col + 1);
    else if (e.key === "ArrowLeft") next.col = Math.max(0, cur.col - 1);
    else if (e.key === "ArrowDown") next.row = Math.min(rows.length - 1, cur.row + 1);
    else if (e.key === "ArrowUp") next.row = Math.max(0, cur.row - 1);
    else if (e.key === "Home") next.col = 0;
    else if (e.key === "End") next.col = hours.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
  }

  return (
    <section data-testid="coverage-heatmap" className="mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Coverage by Hour</div>
        <div className="text-[11px] text-slate-500 tabular-nums">
          {totals.short === 0 ? "No gaps" : `${totals.short} short hour${totals.short === 1 ? "" : "s"}`}
          {totals.over > 0 && ` · ${totals.over} over`}
        </div>
      </div>
      <div className="bg-card rounded-2xl border border-slate-800/60 px-3 py-3">
        <div
          role="grid"
          tabIndex={0}
          aria-label="Coverage by hour for the week. Use arrow keys to move between hours."
          aria-activedescendant={active ? cellId(active.row, active.col) : undefined}
          onKeyDown={move}
          onFocus={() => { if (!active) setActive({ row: 0, col: 0 }); }}
          onMouseLeave={() => setActive(null)}
          className="grid gap-[2px] rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          style={{ gridTemplateColumns: `2.25rem repeat(${hours.length}, minmax(0, 1fr))` }}
        >
          <div role="row" className="contents">
            <div role="columnheader" aria-hidden="true" />
            {hours.map((h, c) => (
              <div key={h} role="columnheader" aria-label={fmtMinutes(h)} className="text-[9px] text-slate-500 tabular-nums leading-none pb-1 overflow-visible whitespace-nowrap">
                {c % labelEvery === 0 ? hourLabel(h) : ""}
              </div>
            ))}
          </div>
          {rows.map((row, r) => (
            <div key={row.date} role="row" className="contents">
              <div role="rowheader" className="text-[10px] font-semibold text-slate-400 flex items-center">
                {DAY_LABELS[dayOfWeek(row.date)]}
              </div>
              {row.cells.map((cell, c) => {
                const isActive = active?.row === r && active?.col === c;
                return (
                  <div
                    key={cell.startMinutes}
                    id={cellId(r, c)}
                    role="gridcell"
                    aria-label={describe(row.date, cell)}
                    aria-selected={isActive}
                    data-kind={cell.kind}
                    onMouseEnter={() => setActive({ row: r, col: c })}
                    onClick={() => setActive({ row: r, col: c })}
                    className={`h-[18px] rounded-[3px] ${cell.kind === "empty" ? "border border-dashed border-slate-800" : ""} ${
                      isActive ? "ring-2 ring-slate-100 ring-offset-1 ring-offset-transparent" : ""
                    }`}
                    style={{ background: cellColor(cell) }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div aria-live="polite" className="min-h-[18px] mt-2 text-[11px] text-slate-300 tabular-nums">
          {activeCell && rows[active!.row] ? describe(rows[active!.row].date, activeCell) : (
            <span className="text-slate-500">Hover or tap an hour for details</span>
          )}
        </div>

        {/* Legend: the diverging scale, labeled, so color never stands alone. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            Short
            {[3, 2, 1].map((n) => (
              <span key={n} className="flex items-center gap-0.5">
                <span aria-hidden="true" className="inline-block w-3 h-3 rounded-[3px]" style={{ background: `var(--color-cov-short-${n})` }} />
                <span className="tabular-nums">{n === 3 ? "3+" : n}</span>
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block w-3 h-3 rounded-[3px]" style={{ background: "var(--color-cov-met)" }} />
            Met
          </span>
          <span className="flex items-center gap-1">
            Over
            {[1, 2, 3].map((n) => (
              <span key={n} className="flex items-center gap-0.5">
                <span aria-hidden="true" className="inline-block w-3 h-3 rounded-[3px]" style={{ background: `var(--color-cov-over-${n})` }} />
                <span className="tabular-nums">{n === 3 ? "3+" : n}</span>
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block w-3 h-3 rounded-[3px] border border-dashed border-slate-700" />
            Not needed
          </span>
        </div>
      </div>
    </section>
  );
}
