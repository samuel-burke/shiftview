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
import { markColor, tint } from "../lib/theme-colors";

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
    <div className="overflow-x-auto rounded-2xl border border-line bg-card" data-testid="week-grid">
      <table className="w-full min-w-[680px] table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[150px] desk:w-[20%]" />
          {dates.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              Team · {employees.length}
            </th>
            {dates.map((date) => {
              const isToday = date === todayKey;
              const isPicked = date === selectedDate;
              const label = (
                <>
                  <span className={`block text-[11px] font-semibold uppercase tracking-wider ${isPicked || isToday ? "text-accent-fg-strong" : "text-fg-muted"}`}>
                    {formatDateKey(date, { weekday: "short" })}
                  </span>
                  <span className={`block text-sm font-bold tabular-nums ${isPicked || isToday ? "text-accent-fg-max" : "text-fg-body"}`}>
                    {formatDateKey(date, { month: "short", day: "numeric" })}
                  </span>
                  {isToday && <span aria-hidden="true" className="mx-auto mt-0.5 block size-1 rounded-full bg-accent-fg" />}
                </>
              );
              return (
                <th
                  key={date}
                  scope="col"
                  aria-current={isToday ? "date" : undefined}
                  className={`px-1 py-2 text-center ${isPicked ? "bg-accent/[0.07]" : ""}`}
                >
                  {onSelectDate ? (
                    <button
                      type="button"
                      onClick={() => onSelectDate(date)}
                      aria-pressed={isPicked}
                      aria-label={`${formatDateKey(date, { weekday: "long", month: "long", day: "numeric" })}${isToday ? ", today" : ""}`}
                      className={`w-full min-h-11 rounded-lg py-1 cursor-pointer border transition-colors ${
                        isPicked ? "bg-accent-solid/25 border-accent-fg" : "bg-transparent border-transparent hover:bg-fill/60"
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
              <tr key={emp.id} className="border-b border-line/70 last:border-b-0">
                <th scope="row" className="px-4 py-1.5 font-normal">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="size-8 shrink-0 rounded-full border border-line-strong bg-fill text-[11px] font-bold text-fg-secondary flex items-center justify-center">
                      {getMonogram(emp.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-fg">{formatDisplayName(emp.name)}</span>
                      <span className="block text-[11px] text-fg-subtle tabular-nums">{fmtHours(weekly)} hrs</span>
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
                  const color = !isLiveContext && type ? SHIFT_COLORS[type] : "var(--status-muted)";
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
                    <td key={date} className={`p-1 align-middle ${date === selectedDate ? "bg-accent/[0.07]" : ""}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(emp, date, target)}
                        aria-label={label}
                        aria-pressed={isSel}
                        className={`group relative w-full h-12 rounded-lg text-left px-2 transition-colors cursor-pointer border ${
                          isSel ? "ring-2 ring-accent-fg ring-offset-1 ring-offset-bg" : ""
                        } ${
                          // A live shift in Draft mode reads as muted by its slate
                          // colors, not by fading the whole cell (which took its
                          // text under 4.5:1).
                          s
                            ? "border-transparent"
                            : requested
                            ? "border-dashed border-line-emphasis bg-transparent"
                            : "border-transparent hover:border-line-strong hover:bg-fill/60 focus-visible:border-line-strong"
                        }`}
                        style={
                          s
                            ? {
                                background: tint(color, isLiveContext ? 14 : 18),
                                boxShadow: `inset 3px 0 0 ${markColor(clash ? "var(--status-warn)" : color)}`,
                              }
                            : undefined
                        }
                      >
                        {s ? (
                          <>
                            {/* In a narrow column (tablet portrait) the times wrap after
                                the dash instead of being cut off; on a tight line, two
                                of them and the label still fit the 48px cell. */}
                            <span className={`block text-[12px] leading-tight font-semibold tabular-nums ${isLiveContext ? "text-fg-secondary" : "text-fg"}`}>
                              {shortTime(s.startMinutes)}–{shortTime(s.endMinutes)}
                            </span>
                            {/* A time-off request leads, so a narrow cell that cuts the
                                line short still shows it. */}
                            <span className="block text-[11px] font-semibold truncate" style={{ color: clash ? "var(--status-warn)" : color }}>
                              {requested ? "Time off? · " : ""}
                              {isLiveContext ? tag : tag ? `${tag}${type ? ` · ${SHIFT_LABEL[type]}` : ""}` : type ? SHIFT_LABEL[type] : "Shift"}
                            </span>
                          </>
                        ) : requested ? (
                          <span className="block text-[11px] font-semibold text-fg-muted">Time off requested</span>
                        ) : (
                          <span aria-hidden="true" className="block text-center text-lg text-fg-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">+</span>
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
          <tr className="border-t border-line">
            <th scope="row" className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              {isDraftMode ? "After publishing" : "Scheduled"}
              <span className="block normal-case tracking-normal text-sm font-bold text-fg-body tabular-nums">{fmtHours(weekHours)} hrs</span>
            </th>
            {dayTotals.map((t, i) => (
              <td key={dates[i]} className={`px-1.5 py-3 text-center align-bottom ${dates[i] === selectedDate ? "bg-accent/[0.07]" : ""}`}>
                <div className="mx-auto mb-1.5 h-10 w-6 flex items-end" aria-hidden="true">
                  <div className="w-full rounded-t bg-info/70" style={{ height: `${(t.hours / maxHours) * 100}%` }} />
                </div>
                <div className="text-[12px] font-bold text-fg-body tabular-nums">{fmtHours(t.hours)}h</div>
                <div className="text-[11px] text-fg-subtle tabular-nums">{t.people} {t.people === 1 ? "person" : "people"}</div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
