"use client";

import { useMemo, useState } from "react";
import { formatDisplayName, type Employee, type Schedule } from "../data/types";
import { limitsFromColumns, type EmployeeLimitColumns, type SchedulingRules } from "../lib/scheduling-rules";
import { scheduledMinutesByEmployee, WEEKLY_OVERTIME_THRESHOLD_MINUTES } from "../lib/schedule-hours";

// Each person's drafted hours this week against their own range (the band from
// their minimum to their maximum), with the 40-hour overtime line. Anyone under
// their minimum, over their maximum or into overtime is listed first.

const COLLAPSED_ROWS = 8;

function fmtHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} h`;
}

type Row = {
  id: number;
  name: string;
  type: "FT" | "PT" | null;
  minutes: number;
  min: number;
  max: number;
  under: boolean;
  overMax: boolean;
  overtime: number;
};

export default function DraftHoursPanel({
  employees,
  drafts,
  dates,
  rules,
  timezone,
}: {
  employees: (Employee & EmployeeLimitColumns)[];
  drafts: Schedule[];
  dates: string[];
  rules: SchedulingRules;
  timezone?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo((): Row[] => {
    const minutesById = scheduledMinutesByEmployee(drafts, dates, timezone);
    return employees
      .map((e) => {
        const limits = limitsFromColumns(e, rules);
        const minutes = minutesById.get(e.id) ?? 0;
        return {
          id: e.id,
          name: formatDisplayName(e.name),
          type: limits.typeSet ? (limits.type === "full_time" ? "FT" : "PT") : null,
          minutes,
          min: limits.minMinutes,
          max: limits.maxMinutes,
          under: minutes < limits.minMinutes,
          overMax: minutes > limits.maxMinutes,
          overtime: Math.max(0, minutes - WEEKLY_OVERTIME_THRESHOLD_MINUTES),
        } satisfies Row;
      })
      .sort((a, b) => {
        const flag = (r: Row) => (r.overMax || r.overtime > 0 ? 0 : r.under ? 1 : 2);
        return flag(a) - flag(b) || b.minutes - a.minutes || a.name.localeCompare(b.name);
      });
  }, [employees, drafts, dates, rules, timezone]);

  if (rows.length === 0) return null;

  // One scale for every row: at least 48 h, rounded up to a 4-hour mark.
  const scale = Math.ceil(Math.max(48 * 60, ...rows.map((r) => Math.max(r.minutes, r.max))) / 240) * 240;
  const pct = (m: number) => `${Math.min(100, (m / scale) * 100)}%`;
  const flagged = rows.filter((r) => r.under || r.overMax || r.overtime > 0).length;
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  return (
    <section data-testid="draft-hours-panel" className="mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Hours This Week</div>
        <div className="text-[11px] text-slate-500">
          {flagged === 0 ? "Everyone within their range" : `${flagged} outside their range`}
        </div>
      </div>
      <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-3">
        <ul className="flex flex-col gap-3">
          {shown.map((r) => (
            <li key={r.id} data-testid={`hours-row-${r.id}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-slate-200 truncate">{r.name}</span>
                {r.type ? (
                  <span className="text-[9px] font-bold text-slate-400 bg-slate-800 rounded px-1 py-px">{r.type}</span>
                ) : (
                  <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 rounded px-1 py-px" title="Employment type not set">?</span>
                )}
                {r.overtime > 0 && (
                  <span className="text-[10px] font-semibold text-red-400">▲ OT +{fmtHours(r.overtime)}</span>
                )}
                {r.overMax && r.overtime === 0 && (
                  <span className="text-[10px] font-semibold text-red-400">▲ Over max</span>
                )}
                {r.under && <span className="text-[10px] font-semibold text-amber-400">▼ Under min</span>}
                <span className="ml-auto text-xs tabular-nums text-slate-300 shrink-0">
                  {fmtHours(r.minutes)}
                  <span className="text-slate-500"> · {r.min === r.max ? fmtHours(r.max) : `${fmtHours(r.min).replace(" h", "")}–${fmtHours(r.max)}`}</span>
                </span>
              </div>
              <div
                className="relative h-2.5 rounded-full bg-slate-800"
                role="img"
                aria-label={`${r.name}: ${fmtHours(r.minutes)} scheduled; range ${fmtHours(r.min)} to ${fmtHours(r.max)}${r.overtime > 0 ? `; ${fmtHours(r.overtime)} overtime` : ""}`}
              >
                {/* Their range */}
                <div
                  className="absolute inset-y-0 rounded-full bg-slate-600/50"
                  style={{ left: pct(r.min), width: `calc(${pct(r.max)} - ${pct(r.min)})`, minWidth: r.max > r.min ? undefined : 2 }}
                />
                {/* Scheduled */}
                {r.minutes > 0 && (
                  <div
                    className={`absolute top-[2px] bottom-[2px] left-0 rounded-full ${r.overMax || r.overtime > 0 ? "bg-red-400" : "bg-blue-500"}`}
                    style={{ width: pct(r.minutes), minWidth: 4 }}
                  />
                )}
                {/* Overtime line */}
                <div
                  aria-hidden="true"
                  className="absolute -top-0.5 -bottom-0.5 border-l border-dashed border-red-400/70"
                  style={{ left: pct(WEEKLY_OVERTIME_THRESHOLD_MINUTES) }}
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 mt-3 pt-2 border-t border-slate-800/60">
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block w-3 h-1.5 rounded-full bg-blue-500" />Scheduled</span>
            <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block w-3 h-2 rounded-full bg-slate-600/50" />Their range</span>
            <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2.5 border-l border-dashed border-red-400/70" />40 h</span>
          </div>
          {rows.length > COLLAPSED_ROWS && (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer p-0 shrink-0"
            >
              {expanded ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
