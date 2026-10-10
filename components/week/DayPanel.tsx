"use client";

import { useMemo } from "react";
import {
  fmtMinutes,
  formatDisplayName,
  getMonogram,
  getShiftType,
  SHIFT_COLORS,
  type Employee,
  type Schedule,
  type StoreHours,
} from "@/data/types";
import { dayOfWeek, scheduledHoursForDate, shiftHours } from "@/lib/draft-metrics";
import { curveHours, type CoverageBlock, type CoverageDefaults, type CoverageOverrides, type CoverageProfile } from "@/lib/coverage";
import { formatDateKey } from "@/lib/dates";
import { limitsFromColumns, type SchedulingRules } from "@/lib/scheduling-rules";
import { scheduledMinutesByEmployee } from "@/lib/schedule-hours";
import { cellKey, weekCells, type SourcedShift, type WeekCell } from "@/lib/week-cells";
import type { WeekMode } from "@/lib/week-params";
import type { PlannerEmployee } from "../AutoScheduleSheet";
import type { PendingTimeOff } from "../WeekGrid";
import { varianceColor } from "./WeekInsights";

// The selected day on the Week page. Phones pick it with DayChips and edit it
// with DayList; tablets and up pick it with the grid's day headers. DayToolbar
// (the day's coverage profile and numbers) shows at every size.

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Phones: the week's seven days, with a dot for each day's hours against its budget. */
export function DayChips({
  dates,
  selectedDate,
  onSelectDate,
  shifts,
  curves,
  timezone,
  ready = true,
}: {
  dates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** False until the store's settings (its week start) are known: the chips
   *  keep their size but show placeholders, rather than one week then another. */
  ready?: boolean;
  /** The shifts the mode counts. */
  shifts: Schedule[];
  curves: Record<string, CoverageBlock[]>;
  timezone?: string;
}) {
  return (
    <div id="week-day-picker" className="grid grid-cols-7 gap-1 mb-3 scroll-mt-4" role="group" aria-label="Day">
      {dates.map((date, i) => {
        const scheduled = scheduledHoursForDate(shifts, date, timezone);
        const budget = curveHours(curves[date] ?? []);
        const active = date === selectedDate;
        return (
          // Keyed by column, not date: when the week moves (or the store's week
          // start arrives) each chip stays put and its contents change.
          <button
            key={i}
            type="button"
            onClick={() => onSelectDate(date)}
            // Placeholders can't be picked: the day under them is about to change.
            disabled={!ready}
            aria-pressed={ready ? active : undefined}
            aria-label={ready ? formatDateKey(date, { weekday: "long", month: "long", day: "numeric" }) : undefined}
            className={`flex flex-col items-center py-2 rounded-xl cursor-pointer transition-colors border ${
              active
                ? "bg-indigo-600/25 border-indigo-500/40 text-indigo-200"
                : "bg-card border-slate-800/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="text-[11px] font-semibold uppercase">
              {ready ? DAY_LABELS[dayOfWeek(date)] : <span className="skeleton rounded text-transparent">Sun</span>}
            </span>
            <span className="text-sm font-bold tabular-nums">
              {ready ? Number(date.slice(8, 10)) : <span className="skeleton rounded text-transparent">00</span>}
            </span>
            <span
              aria-hidden="true"
              className={`mt-1 w-1.5 h-1.5 rounded-full ${
                scheduled === 0 ? "bg-slate-700" : scheduled > budget && budget > 0 ? "bg-red-400" : "bg-green-500"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

/** The selected day's coverage profile (override or the weekday default) and its hours. */
export function DayToolbar({
  date,
  shifts,
  curves,
  timezone,
  profiles,
  defaults,
  overrides,
  onAssignProfile,
}: {
  date: string;
  shifts: Schedule[];
  curves: Record<string, CoverageBlock[]>;
  timezone?: string;
  profiles: CoverageProfile[];
  defaults: CoverageDefaults;
  overrides: CoverageOverrides;
  onAssignProfile: (date: string, profileId: number | null) => void;
}) {
  const scheduled = round1(scheduledHoursForDate(shifts, date, timezone));
  const budget = round1(curveHours(curves[date] ?? []));
  const variance = round1(scheduled - budget);
  const defaultName = profiles.find((p) => p.id === defaults[dayOfWeek(date)])?.name;

  return (
    <section aria-label="Selected day" className="mb-3 flex flex-col gap-2 tablet:flex-row tablet:items-center tablet:gap-3">
      <h2 className="hidden tablet:block text-sm font-bold text-slate-100 whitespace-nowrap" data-testid="selected-day">
        {formatDateKey(date, { weekday: "long", month: "short", day: "numeric" })}
      </h2>
      <div className="flex items-center gap-2 bg-card rounded-xl px-3 py-2 border border-slate-800/60 tablet:flex-1 tablet:max-w-sm">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold shrink-0">Coverage</span>
        <select
          value={overrides[date] ?? ""}
          aria-label="Coverage profile for selected day"
          onChange={(e) => onAssignProfile(date, e.target.value === "" ? null : Number(e.target.value))}
          className="flex-1 min-w-0 min-h-9 bg-bg border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500/70 transition-colors cursor-pointer"
        >
          <option value="">Default ({defaultName ?? "none"})</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {overrides[date] !== undefined && (
          <span className="text-[11px] font-bold uppercase text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded-full px-2 py-0.5 shrink-0">
            Override
          </span>
        )}
      </div>
      <div className="flex gap-2 tablet:ml-auto">
        {[
          { label: "Scheduled", value: `${scheduled} hrs`, color: "#3b82f6" },
          { label: "Budget", value: `${budget} hrs`, color: "#818cf8" },
          { label: "Variance", value: `${variance > 0 ? "+" : ""}${variance} hrs`, color: varianceColor(variance) },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex-1 tablet:flex-none tablet:min-w-[92px] bg-card rounded-xl px-2 py-2 text-center border border-slate-800/60">
            <div className="text-xs font-bold tabular-nums" style={{ color }}>{value}</div>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pill({ tone, children }: { tone: "live" | "draft" | "auto"; children: React.ReactNode }) {
  const tones = {
    live: "text-slate-400 bg-slate-800 border-slate-700",
    draft: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    auto: "text-violet-300 bg-violet-500/15 border-violet-500/25",
  };
  return (
    <span className={`text-[11px] font-bold uppercase rounded-full px-2 py-0.5 shrink-0 border ${tones[tone]}`}>{children}</span>
  );
}

/**
 * Phones: everyone's shift on the selected day, working first. Tapping a row
 * edits it, as a grid cell does. In Draft mode live shifts are read-only
 * context, and a draft that clashes with one is flagged: it won't publish.
 */
export function DayList({
  mode,
  date,
  dates,
  employees,
  shifts,
  storeHours,
  timeOff,
  rules,
  timezone,
  loading,
  selected,
  onSelect,
  notice,
}: {
  /** Shown at the top of the list once it has loaded (Draft mode's "no drafts"). */
  notice?: React.ReactNode;
  mode: WeekMode;
  date: string;
  dates: string[];
  employees: PlannerEmployee[];
  /** Live shifts, plus drafts in Draft mode (the grid's input). */
  shifts: SourcedShift[];
  storeHours: Record<number, StoreHours>;
  timeOff: PendingTimeOff[];
  rules: SchedulingRules;
  timezone?: string;
  loading: boolean;
  selected: { employeeId: number; date: string } | null;
  onSelect: (employee: Employee, date: string) => void;
}) {
  const isDraftMode = mode === "draft";
  const cells = useMemo(() => weekCells(shifts, mode), [shifts, mode]);
  const minutesById = useMemo(() => {
    const shown = [...cells.values()].map((c) => c.shown).filter((s): s is SourcedShift => s !== null);
    return scheduledMinutesByEmployee(shown, dates, timezone);
  }, [cells, dates, timezone]);
  const requested = new Set(timeOff.filter((t) => t.date === date).map((t) => t.employeeId));
  const hours = storeHours[dayOfWeek(date)];

  const rows = employees
    .map((emp) => ({ emp, cell: cells.get(cellKey(emp.id, date)) ?? ({ live: null, draft: null, shown: null } as WeekCell) }))
    .sort((a, b) => {
      if (!a.cell.shown !== !b.cell.shown) return a.cell.shown ? -1 : 1;
      return (a.cell.shown?.startMinutes ?? 0) - (b.cell.shown?.startMinutes ?? 0);
    });

  function weekHours(emp: PlannerEmployee): { text: string; over: boolean } {
    const minutes = minutesById.get(emp.id) ?? 0;
    const { maxMinutes } = limitsFromColumns(emp, rules);
    const h = (m: number) => round1(m / 60);
    return { text: `${h(minutes)}/${h(maxMinutes)} h week`, over: minutes > maxMinutes };
  }

  return (
    <div
      className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60 mb-4"
      data-testid="day-list"
      aria-busy={loading || undefined}
    >
      {loading ? (
        // One row per person, shaped like the real rows, so the list (and what's
        // under it) keeps its height while the week loads.
        Array.from({ length: employees.length || 6 }, (_, i) => (
          <div key={`sk-${i}`} aria-hidden="true" className="w-full min-h-14 flex items-center gap-3 px-4 py-3">
            <div className="skeleton size-9 rounded-full shrink-0" />
            {/* The real rows' two lines, in their own fonts. */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold"><span className="skeleton rounded text-transparent">Alice S.</span></div>
              <div className="text-xs"><span className="skeleton rounded text-transparent">9:00 AM – 5:00 PM · 8 hrs</span></div>
            </div>
          </div>
        ))
      ) : employees.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-500">No employees</div>
      ) : (
        <>
        {notice}
        {rows.map(({ emp, cell }) => {
          const s = cell.shown;
          const isLiveContext = isDraftMode && cell.live !== null;
          const clash = isDraftMode && cell.live !== null && cell.draft !== null;
          const type = s && hours ? getShiftType(s.startMinutes, s.endMinutes, hours.open, hours.close) : null;
          const color = isLiveContext ? "#64748b" : type ? SHIFT_COLORS[type] : "#94a3b8";
          const week = weekHours(emp);
          const timeOffRequested = requested.has(emp.id);
          const isSel = selected?.employeeId === emp.id && selected.date === date;
          const status = !isDraftMode || !s
            ? ""
            : clash
            ? ", live shift; a draft for this day won't publish. Open the draft"
            : isLiveContext
            ? ", live shift (change it in Live mode)"
            : s.generationRunId
            ? ", auto draft"
            : ", draft";
          const label = s
            ? `${emp.name}: ${fmtMinutes(s.startMinutes)} to ${fmtMinutes(s.endMinutes)}${status}${timeOffRequested ? ", time off requested" : ""}`
            : `${emp.name}: off${timeOffRequested ? ", time off requested" : ""}. Add a ${isDraftMode ? "draft " : ""}shift`;
          return (
            <button
              key={emp.id}
              type="button"
              onClick={() => onSelect(emp, date)}
              aria-label={label}
              aria-pressed={isSel}
              className={`w-full min-h-14 flex items-center gap-3 px-4 py-3 border-none cursor-pointer text-left transition-colors ${
                isSel ? "bg-indigo-500/10" : "bg-transparent hover:bg-slate-800/40"
              }`}
            >
              <div
                className={`size-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  s ? "" : "bg-slate-800 border border-slate-700 text-slate-500"
                }`}
                style={
                  s
                    ? {
                        background: `color-mix(in srgb, ${color} 18%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
                        color,
                      }
                    : undefined
                }
              >
                {getMonogram(emp.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold truncate ${s ? "text-slate-200" : "text-slate-400"}`}>{formatDisplayName(emp.name)}</div>
                <div className={`text-xs tabular-nums ${s ? "text-slate-400" : "text-slate-500"}`}>
                  {s ? `${fmtMinutes(s.startMinutes)} – ${fmtMinutes(s.endMinutes)} · ${round1(shiftHours(s, timezone))} hrs` : "Off"}
                  <span className={week.over ? "text-red-400" : "text-slate-500"}> · {week.text}</span>
                </div>
                {clash && cell.draft && (
                  <div className="text-xs text-amber-400 mt-0.5">
                    Draft {fmtMinutes(cell.draft.startMinutes)} – {fmtMinutes(cell.draft.endMinutes)} won&apos;t publish
                  </div>
                )}
                {timeOffRequested && <div className="text-xs text-amber-400 mt-0.5">Time off requested</div>}
              </div>
              {s ? (
                isLiveContext ? (
                  <Pill tone="live">Live</Pill>
                ) : isDraftMode ? (
                  s.generationRunId ? <Pill tone="auto">Auto</Pill> : <Pill tone="draft">Draft</Pill>
                ) : null
              ) : (
                <span aria-hidden="true" className="text-[11px] font-semibold text-indigo-400 shrink-0">+ Add</span>
              )}
            </button>
          );
        })}
        </>
      )}
    </div>
  );
}
