"use client";

import {
  Employee,
  StoreHours,
  TimeOffRequest,
  getShiftType,
  getMonogram,
  formatDisplayName,
  SHIFT_COLORS,
} from "../data/types";
import { dayOfWeekForKey, formatDateKey } from "@/lib/dates";
import { shiftMinutes } from "@/lib/schedule-hours";
import { cellKey, weekCells, type SourcedShift, type WeekCell } from "@/lib/week-cells";
import { shortTime } from "./WeekView";

/** A pending time-off request as the manager's GET /api/time-off returns it. */
export type PendingTimeOff = TimeOffRequest & { employeeId: number };

/** A shift on the grid: live (published) or a draft. */
export type GridShift = SourcedShift;

type Props = {
  employees: Employee[];
  /** Every shift in the week, any employee: live ones, plus drafts in Draft mode. */
  schedules: GridShift[];
  /** The seven store-local date keys, in display order. */
  dates: string[];
  weeklyHours: Record<number, StoreHours>;
  todayKey: string;
  /**
   * "live" edits published shifts. "draft" edits drafts; live shifts stay on
   * the grid as muted, read-only context, since publishing keeps them.
   */
  mode?: "live" | "draft";
  /** Store timezone, for hours across a DST change. */
  timezone?: string;
  timeOff?: PendingTimeOff[];
  selected?: { employeeId: number; date: string } | null;
  onSelect: (employee: Employee, date: string, shift: GridShift | null) => void;
  /** The day the page is focused on: its column is highlighted, and the day headers pick it. */
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
};

const SHIFT_LABEL = { opener: "Opener", mid: "Mid", closer: "Closer" } as const;

function fmtHours(h: number): string {
  return Number.isInteger(h) ? `${h}` : h.toFixed(1);
}

/*
 * Manager week grid: people as rows, days as columns, one cell per shift.
 * A plain <table> so screen readers announce the person and day for each cell.
 * On narrow screens the table scrolls sideways inside its own container.
 */
export default function WeekGrid({
  employees,
  schedules,
  dates,
  weeklyHours,
  todayKey,
  mode = "live",
  timezone,
  timeOff = [],
  selected = null,
  onSelect,
  selectedDate = null,
  onSelectDate,
}: Props) {
  const isDraftMode = mode === "draft";
  const cells = weekCells(schedules, mode);
  const EMPTY: WeekCell = { live: null, draft: null, shown: null };
  const cellOf = (employeeId: number, date: string): WeekCell => cells.get(cellKey(employeeId, date)) ?? EMPTY;
  const timeOffCell = new Set(timeOff.map((t) => `${t.employeeId}|${t.date}`));
  const hoursOf = (s: GridShift) => Math.max(0, shiftMinutes(s, timezone)) / 60;

  const dayTotals = dates.map((date) => {
    const shown = employees.map((e) => cellOf(e.id, date).shown).filter((s): s is GridShift => s !== null);
    return { people: shown.length, hours: shown.reduce((n, s) => n + hoursOf(s), 0) };
  });
  const maxHours = Math.max(1, ...dayTotals.map((d) => d.hours));
  const weekHours = dayTotals.reduce((n, d) => n + d.hours, 0);

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-card" data-testid="week-grid">
      <table className="w-full min-w-[680px] table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[150px] desk:w-[20%]" />
          {dates.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr className="border-b border-slate-800">
            <th scope="col" className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Team · {employees.length}
            </th>
            {dates.map((date) => {
              const isToday = date === todayKey;
              const isPicked = date === selectedDate;
              const label = (
                <>
                  <span className={`block text-[11px] font-semibold uppercase tracking-wider ${isPicked || isToday ? "text-indigo-300" : "text-slate-400"}`}>
                    {formatDateKey(date, { weekday: "short" })}
                  </span>
                  <span className={`block text-sm font-bold tabular-nums ${isPicked || isToday ? "text-indigo-200" : "text-slate-200"}`}>
                    {formatDateKey(date, { month: "short", day: "numeric" })}
                  </span>
                  {isToday && <span aria-hidden="true" className="mx-auto mt-0.5 block size-1 rounded-full bg-indigo-400" />}
                </>
              );
              return (
                <th
                  key={date}
                  scope="col"
                  aria-current={isToday ? "date" : undefined}
                  className={`px-1 py-2 text-center ${isPicked ? "bg-indigo-500/[0.07]" : ""}`}
                >
                  {onSelectDate ? (
                    <button
                      type="button"
                      onClick={() => onSelectDate(date)}
                      aria-pressed={isPicked}
                      aria-label={`${formatDateKey(date, { weekday: "long", month: "long", day: "numeric" })}${isToday ? ", today" : ""}`}
                      className={`w-full min-h-11 rounded-lg py-1 cursor-pointer border transition-colors ${
                        isPicked ? "bg-indigo-600/25 border-indigo-500/40" : "bg-transparent border-transparent hover:bg-slate-800/60"
                      }`}
                    >
                      {label}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {employees.map((emp) => {
            const weekly = dates.reduce((n, d) => {
              const s = cellOf(emp.id, d).shown;
              return n + (s ? hoursOf(s) : 0);
            }, 0);
            return (
              <tr key={emp.id} className="border-b border-slate-800/70 last:border-b-0">
                <th scope="row" className="px-4 py-1.5 font-normal">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="size-8 shrink-0 rounded-full border border-slate-700 bg-slate-800 text-[11px] font-bold text-slate-300 flex items-center justify-center">
                      {getMonogram(emp.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-100">{formatDisplayName(emp.name)}</span>
                      <span className="block text-[11px] text-slate-500 tabular-nums">{fmtHours(weekly)} hrs</span>
                    </span>
                  </div>
                </th>
                {dates.map((date) => {
                  const cell = cellOf(emp.id, date);
                  const s = cell.shown;
                  // Draft mode: live shifts are read-only context; a draft on a day
                  // with a live shift (made before that was blocked) won't publish.
                  const isLiveContext = isDraftMode && cell.live !== null;
                  const clash = isDraftMode && cell.live !== null && cell.draft !== null;
                  const hours = weeklyHours[dayOfWeekForKey(date)];
                  const type = s && hours ? getShiftType(s.startMinutes, s.endMinutes, hours.open, hours.close) : null;
                  const color = isLiveContext ? "#64748b" : type ? SHIFT_COLORS[type] : "#94a3b8";
                  const requested = timeOffCell.has(`${emp.id}|${date}`);
                  const isSel = selected?.employeeId === emp.id && selected.date === date;
                  const dayLabel = formatDateKey(date, { weekday: "long", month: "long", day: "numeric" });
                  // Draft mode leads with where the shift stands, so a narrow
                  // cell cuts the shift type, not that.
                  const tag = !isDraftMode
                    ? ""
                    : clash
                    ? "Clash"
                    : isLiveContext
                    ? "Live"
                    : s?.generationRunId
                    ? "Auto"
                    : s
                    ? "Draft"
                    : "";
                  const what = s ? `${type ? SHIFT_LABEL[type] + " " : ""}${shortTime(s.startMinutes)} to ${shortTime(s.endMinutes)}` : "off";
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
                    ? `${emp.name}, ${dayLabel}: ${what}${status}${requested ? ", time off requested" : ""}`
                    : `${emp.name}, ${dayLabel}: off${requested ? ", time off requested" : ""}. Add a ${isDraftMode ? "draft " : ""}shift`;
                  // Clicking a clash opens the draft so it can be removed.
                  const target = isDraftMode ? (clash ? cell.draft : s) : cell.live;
                  return (
                    <td key={date} className={`p-1 align-middle ${date === selectedDate ? "bg-indigo-500/[0.07]" : ""}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(emp, date, target)}
                        aria-label={label}
                        aria-pressed={isSel}
                        className={`group relative w-full h-12 rounded-lg text-left px-2 transition-colors cursor-pointer border ${
                          isSel ? "ring-2 ring-indigo-400 ring-offset-1 ring-offset-bg" : ""
                        } ${
                          s
                            ? isLiveContext
                              ? "border-transparent opacity-70"
                              : "border-transparent"
                            : requested
                            ? "border-dashed border-slate-500 bg-transparent"
                            : "border-transparent hover:border-slate-700 hover:bg-slate-800/60 focus-visible:border-slate-700"
                        }`}
                        style={
                          s
                            ? {
                                background: `color-mix(in srgb, ${color} ${isLiveContext ? 14 : 18}%, transparent)`,
                                boxShadow: `inset 3px 0 0 ${clash ? "#f59e0b" : color}`,
                              }
                            : undefined
                        }
                      >
                        {s ? (
                          <>
                            <span className={`block text-[12px] font-semibold tabular-nums truncate ${isLiveContext ? "text-slate-300" : "text-slate-100"}`}>
                              {shortTime(s.startMinutes)}–{shortTime(s.endMinutes)}
                            </span>
                            <span className="block text-[11px] font-semibold truncate" style={{ color: clash ? "#f59e0b" : color }}>
                              {isLiveContext ? tag : tag ? `${tag}${type ? ` · ${SHIFT_LABEL[type]}` : ""}` : type ? SHIFT_LABEL[type] : "Shift"}
                              {requested ? " · Time off?" : ""}
                            </span>
                          </>
                        ) : requested ? (
                          <span className="block text-[11px] font-semibold text-slate-400">Time off requested</span>
                        ) : (
                          <span aria-hidden="true" className="block text-center text-lg text-slate-600 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">+</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr className="border-t border-slate-800">
            <th scope="row" className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {isDraftMode ? "After publishing" : "Scheduled"}
              <span className="block normal-case tracking-normal text-sm font-bold text-slate-200 tabular-nums">{fmtHours(weekHours)} hrs</span>
            </th>
            {dayTotals.map((t, i) => (
              <td key={dates[i]} className={`px-1.5 py-3 text-center align-bottom ${dates[i] === selectedDate ? "bg-indigo-500/[0.07]" : ""}`}>
                <div className="mx-auto mb-1.5 h-10 w-6 flex items-end" aria-hidden="true">
                  <div className="w-full rounded-t bg-blue-500/70" style={{ height: `${(t.hours / maxHours) * 100}%` }} />
                </div>
                <div className="text-[12px] font-bold text-slate-200 tabular-nums">{fmtHours(t.hours)}h</div>
                <div className="text-[11px] text-slate-500 tabular-nums">{t.people} {t.people === 1 ? "person" : "people"}</div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
