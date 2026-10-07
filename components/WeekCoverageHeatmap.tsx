"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { CoverageBlock } from "../lib/coverage";
import { coverageHeatmap, heatRanges, type HeatCell, type HeatRange } from "../lib/coverage-heatmap";
import { dayOfWeek, type ShiftSpan } from "../lib/draft-metrics";

// Staffing against the coverage target, hour by hour for the week. Diverging:
// amber = short (the Week page's understaffed color), blue = more people than
// needed (its "scheduled" color), neutral = met; deeper = further off. Grid
// shows the week's shape; List gives each day's off-target ranges, easier to
// read on a phone than small cells. Colors: --color-cov-* in globals.css.
// Linked to the Week page's day picker: the selected day's row is highlighted,
// and tapping an hour selects its day.

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type View = "grid" | "list";

function cellColor(cell: HeatCell): string {
  if (cell.kind === "met") return "var(--color-cov-met)";
  if (cell.kind === "empty") return "transparent";
  return `var(--color-cov-${cell.kind}-${Math.min(3, Math.abs(cell.diff))})`;
}

function clock(minutes: number): { time: string; suffix: string } {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { time: m === 0 ? String(h12) : `${h12}:${String(m).padStart(2, "0")}`, suffix: h >= 12 ? "PM" : "AM" };
}

// "9–10 AM", "11 AM–1 PM".
function clockRange(start: number, end: number): string {
  const a = clock(start);
  const b = clock(end);
  return a.suffix === b.suffix ? `${a.time}–${b.time} ${b.suffix}` : `${a.time} ${a.suffix}–${b.time} ${b.suffix}`;
}

function axisLabel(minutes: number): string {
  const { time, suffix } = clock(minutes);
  return `${time}${suffix === "AM" ? "a" : "p"}`;
}

function status(cell: HeatCell): string {
  if (cell.kind === "empty") return "no one needed";
  const counts = `${cell.scheduled} of ${cell.target} scheduled`;
  if (cell.kind === "met") return `${counts} · target met`;
  return `${counts} · ${cell.kind === "short" ? "short" : "over"} by ${Math.abs(cell.diff)}`;
}

function describe(date: string, cell: HeatCell): string {
  return `${DAY_NAMES[dayOfWeek(date)]} ${clockRange(cell.startMinutes, cell.startMinutes + 60)}: ${status(cell)}`;
}

function Swatch({ color, className = "" }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-2.5 rounded-[3px] ${className}`} style={{ background: color }} />;
}

function LegendChip({ colors, label }: { colors: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40">
      <span className="flex gap-px">{colors.map((c) => <Swatch key={c} color={c} />)}</span>
      {label}
    </span>
  );
}

function RangeChip({ range }: { range: HeatRange }) {
  const short = range.kind === "short";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs tabular-nums rounded-full px-2.5 py-1 border ${
        short ? "bg-amber-500/10 border-amber-500/25 text-amber-400" : "bg-blue-500/10 border-blue-500/25 text-blue-400"
      }`}
    >
      <Swatch color={`var(--color-cov-${range.kind}-${Math.min(3, Math.abs(range.diff))})`} />
      {clockRange(range.startMinutes, range.endMinutes)}
      <span className="font-semibold">{short ? `short ${-range.diff}` : `+${range.diff}`}</span>
    </span>
  );
}

export default function WeekCoverageHeatmap({
  shifts,
  dates,
  curves,
  selectedDate,
  onSelectDate,
}: {
  shifts: ShiftSpan[];
  dates: string[];
  curves: Record<string, CoverageBlock[]>;
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}) {
  const { hours, rows } = useMemo(() => coverageHeatmap(shifts, dates, curves), [shifts, dates, curves]);
  const [view, setView] = useState<View>("grid");
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);

  const totals = useMemo(() => {
    let short = 0, over = 0, empty = 0;
    for (const r of rows) for (const c of r.cells) {
      if (c.kind === "short") short++;
      else if (c.kind === "over") over++;
      else if (c.kind === "empty") empty++;
    }
    return { short, over, empty };
  }, [rows]);

  const header = (
    <div className="flex items-center justify-between gap-2 mb-2 pl-1.5 pr-1">
      <h2 id="coverage-heatmap-title" className="text-[11px] font-bold tracking-[0.1em] text-slate-400 uppercase">
        Coverage by Hour
      </h2>
      {hours.length > 0 && (
        <div className="flex rounded-lg bg-slate-800/60 border border-slate-700/40 p-0.5" role="tablist" aria-label="Coverage by hour view">
          {(["grid", "list"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`min-h-8 px-3 text-[11px] font-semibold rounded-md cursor-pointer transition-colors border-none ${
                view === v ? "bg-indigo-600/40 text-indigo-200" : "bg-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {v === "grid" ? "Grid" : "List"}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const card = (children: React.ReactNode) => (
    <motion.section
      data-testid="coverage-heatmap"
      aria-labelledby="coverage-heatmap-title"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      {header}
      {children}
    </motion.section>
  );

  if (hours.length === 0) {
    return card(<div className="px-1.5 pt-2 pb-4 text-sm text-slate-500">No coverage targets or shifts this week</div>);
  }

  const activeCell = active ? rows[active.row]?.cells[active.col] : undefined;
  const cellId = (r: number, c: number) => `heat-${r}-${c}`;
  // Phones label every 2nd or 3rd hour so the labels never collide; tablets
  // and up label every hour until the week spans more than 16.
  const phoneStep = hours.length > 16 ? 3 : hours.length > 8 ? 2 : 1;
  const wideStep = hours.length > 16 ? 2 : 1;
  const labelClass = (c: number) =>
    c % phoneStep === 0 ? (c % wideStep === 0 ? "" : "tablet:invisible") : c % wideStep === 0 ? "invisible tablet:visible" : "invisible";

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

  return card(
    <>
      <div className="flex flex-wrap items-center gap-1.5 mb-3 pl-1.5">
        <LegendChip colors={["var(--color-cov-short-3)", "var(--color-cov-short-2)", "var(--color-cov-short-1)"]} label="Short" />
        <LegendChip colors={["var(--color-cov-met)"]} label="Met" />
        <LegendChip colors={["var(--color-cov-over-1)", "var(--color-cov-over-2)", "var(--color-cov-over-3)"]} label="Over" />
        <span className="ml-auto pr-1 text-[11px] text-slate-500 tabular-nums">
          {totals.short === 0 ? "No gaps" : `${totals.short} short hour${totals.short === 1 ? "" : "s"}`}
          {totals.over > 0 && ` · ${totals.over} over`}
        </span>
      </div>

      {view === "grid" ? (
        <>
          <div
            role="grid"
            tabIndex={0}
            aria-label="Coverage by hour for the week. Use the arrow keys to move between hours."
            aria-activedescendant={active ? cellId(active.row, active.col) : undefined}
            onKeyDown={move}
            onFocus={() => { if (!active) setActive({ row: 0, col: 0 }); }}
            onMouseLeave={() => setActive(null)}
            className="grid gap-[2px] px-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            style={{ gridTemplateColumns: `2.25rem repeat(${hours.length}, minmax(0, 1fr))` }}
          >
            <div role="row" className="contents">
              <div role="columnheader" aria-hidden="true" />
              {hours.map((h, c) => (
                <div
                  key={h}
                  role="columnheader"
                  aria-label={clockRange(h, h + 60)}
                  className={`text-[11px] text-slate-500 tabular-nums leading-none pb-1.5 whitespace-nowrap overflow-visible ${labelClass(c)}`}
                >
                  {axisLabel(h)}
                </div>
              ))}
            </div>
            {rows.map((row, r) => (
              <div key={row.date} role="row" aria-selected={row.date === selectedDate} className="contents">
                <div
                  role="rowheader"
                  onClick={() => onSelectDate?.(row.date)}
                  className={`text-[11px] font-semibold flex items-center ${onSelectDate ? "cursor-pointer" : ""} ${
                    row.date === selectedDate ? "text-indigo-300" : "text-slate-400"
                  }`}
                >
                  {row.date === selectedDate && <span aria-hidden="true" className="w-[3px] h-3.5 rounded-full bg-indigo-400 mr-1 -ml-1" />}
                  {DAY_SHORT[dayOfWeek(row.date)]}
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
                      onClick={() => {
                        setActive({ row: r, col: c });
                        onSelectDate?.(row.date);
                      }}
                      className={`h-6 tablet:h-7 rounded-[4px] flex items-center justify-center cursor-pointer transition-shadow ${
                        isActive ? "ring-2 ring-slate-100" : ""
                      }`}
                      style={{ background: cellColor(cell) }}
                    >
                      {cell.kind === "empty" && (
                        <span aria-hidden="true" className="size-1 rounded-full" style={{ background: "var(--color-cov-empty)" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div
            aria-live="polite"
            className="flex items-center gap-2 min-h-10 mt-3 mx-1 px-3 py-2 rounded-xl bg-slate-800/40 text-xs"
          >
            {activeCell && rows[active!.row] ? (
              <>
                <Swatch color={activeCell.kind === "empty" ? "var(--color-cov-empty)" : cellColor(activeCell)} className="shrink-0" />
                <span className="font-semibold text-slate-200 whitespace-nowrap">
                  {DAY_SHORT[dayOfWeek(rows[active!.row].date)]} {clockRange(activeCell.startMinutes, activeCell.startMinutes + 60)}
                </span>
                <span className="text-slate-400 tabular-nums min-w-0">{status(activeCell)}</span>
              </>
            ) : (
              <span className="text-slate-500">Hover or tap an hour for details</span>
            )}
          </div>
          {totals.empty > 0 && (
            <div className="flex items-center gap-1.5 mt-2 px-2 text-[11px] text-slate-500">
              <span aria-hidden="true" className="size-1 rounded-full" style={{ background: "var(--color-cov-empty)" }} />
              No one needed
            </div>
          )}
        </>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-800/60 px-1.5" aria-label="Hours off target by day">
          {rows.map((row) => {
            const ranges = heatRanges(row);
            const needed = row.cells.some((c) => c.kind !== "empty");
            return (
              <li key={row.date} className="flex items-start gap-3 py-2.5">
                <button
                  onClick={() => onSelectDate?.(row.date)}
                  aria-pressed={row.date === selectedDate}
                  aria-label={`Select ${DAY_NAMES[dayOfWeek(row.date)]}`}
                  className={`w-11 min-h-8 -my-1 shrink-0 rounded-lg text-left pl-1.5 text-xs font-semibold border-none cursor-pointer ${
                    row.date === selectedDate ? "bg-indigo-600/25 text-indigo-200" : "bg-transparent text-slate-300 hover:text-slate-100"
                  }`}
                >
                  {DAY_SHORT[dayOfWeek(row.date)]}
                </button>
                <div className="flex flex-wrap gap-1.5 min-w-0">
                  {ranges.length > 0 ? (
                    ranges.map((range) => <RangeChip key={`${range.kind}-${range.startMinutes}`} range={range} />)
                  ) : needed ? (
                    <span className="pt-1 text-xs text-emerald-400">✓ Every hour covered</span>
                  ) : (
                    <span className="pt-1 text-xs text-slate-500">No one needed</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
