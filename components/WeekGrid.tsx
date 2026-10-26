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

const fmtShort = (s: { startMinutes: number; endMinutes: number }) => `${shortTime(s.startMinutes)}–${shortTime(s.endMinutes)}`;
import { markColor, tint } from "../lib/theme-colors";

/** A pending or approved time-off request, as GET /api/time-off?from=&to= returns it. */
export type WeekTimeOff = TimeOffRequest & { employeeId: number };

/** Each person's time off by cell key. An approved request outranks a pending one. */
export function timeOffByCell(timeOff: WeekTimeOff[]): Map<string, "pending" | "approved"> {
  const byCell = new Map<string, "pending" | "approved">();
  for (const t of timeOff) {
    if (t.status !== "pending" && t.status !== "approved") continue;
    const key = `${t.employeeId}|${t.date}`;
    if (byCell.get(key) !== "approved") byCell.set(key, t.status);
  }
  return byCell;
}

/** Part-day time off by cell key ("Off 3–6p"); whole days aren't listed. */
export function partDayByCell(timeOff: WeekTimeOff[]): Map<string, { startMinutes: number; endMinutes: number }> {
  const byCell = new Map<string, { startMinutes: number; endMinutes: number }>();
  for (const t of timeOff) {
    if ((t.status === "pending" || t.status === "approved") && t.startMinutes != null && t.endMinutes != null)
      byCell.set(`${t.employeeId}|${t.date}`, { startMinutes: t.startMinutes, endMinutes: t.endMinutes });
  }
  return byCell;
}

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
  timeOff?: WeekTimeOff[];
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
  const EMPTY: WeekCell = { live: null, draft: null, change: null, shown: null };
  const cellOf = (employeeId: number, date: string): WeekCell => cells.get(cellKey(employeeId, date)) ?? EMPTY;
  const timeOffCell = timeOffByCell(timeOff);
  const partDayCell = partDayByCell(timeOff);
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
                      className={`w-full min-h-11 rounded-lg py-1 cursor-pointer border transition-colors ${
                        isPicked ? "bg-accent-solid/25 border-accent-fg" : "bg-transparent border-transparent hover:bg-fill/60"
                      }`}
                    >
                      {/* Named by its text, the abbreviations spelled out for
                          screen readers (WCAG 2.5.3). */}
                      <span className="sr-only">{formatDateKey(date, { weekday: "long", month: "long", day: "numeric" })}{isToday ? ", today" : ""}</span>
                      <span aria-hidden="true">{label}</span>
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
                  // Draft mode: an unchanged live shift is context; a draft that
                  // changes it shows as "Changed" (or "Removed"); any other draft
                  // on a day with a live shift won't publish.
                  const isLiveContext = isDraftMode && cell.live !== null && cell.change === null;
                  const clash = isLiveContext && cell.draft !== null;
                  const removed = isDraftMode && cell.change === "remove";
                  const hours = weeklyHours[dayOfWeekForKey(date)];
                  const type = s && hours ? getShiftType(s.startMinutes, s.endMinutes, hours.open, hours.close) : null;
                  const color = !isLiveContext && type ? SHIFT_COLORS[type] : "var(--status-muted)";
                  const timeOffStatus = timeOffCell.get(`${emp.id}|${date}`);
                  const partDay = partDayCell.get(`${emp.id}|${date}`);
                  const partDayText = partDay ? ` ${shortTime(partDay.startMinutes)}–${shortTime(partDay.endMinutes)}` : "";
                  const requested = timeOffStatus === "pending";
                  const approved = timeOffStatus === "approved";
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
                    : cell.change === "edit"
                    ? "Changed"
                    : s?.generationRunId
                    ? "Auto"
                    : s
                    ? "Draft"
                    : "";
                  // The cell is named by its text (WCAG 2.5.3); who, when, and what
                  // a tap does follow it for screen readers.
                  const status = !isDraftMode || !s
                    ? ""
                    : clash
                    ? ", live shift; a draft for this day won't publish. Open the draft"
                    : isLiveContext
                    ? ", live shift. Change it as a draft"
                    : cell.change === "edit"
                    ? `, changes the live ${fmtShort(cell.live!)} shift when published`
                    : "";
                  const timeOffNote = approved ? `, time off approved${partDayText}` : requested ? `, time off requested${partDayText}` : "";
                  const context = s
                    ? `, ${emp.name}, ${dayLabel}${status}${timeOffNote}`
                    : removed
                    ? `, ${emp.name}, ${dayLabel}: the live shift is removed when published. Open the draft`
                    : `${timeOffStatus ? ", " : ""}${emp.name}, ${dayLabel}: off. Add a ${isDraftMode ? "draft " : ""}shift`;
                  // Clicking a clash or a change opens the draft.
                  const target = isDraftMode ? (clash || cell.change ? cell.draft : s) : cell.live;
                  return (
                    <td key={date} className={`p-1 align-middle ${date === selectedDate ? "bg-accent/[0.07]" : ""}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(emp, date, target)}
                        aria-pressed={isSel}
                        className={`group relative w-full h-12 rounded-lg text-left px-2 transition-colors cursor-pointer border ${
                          isSel ? "ring-2 ring-accent-fg ring-offset-1 ring-offset-bg" : ""
                        } ${
                          // A live shift in Draft mode reads as muted by its slate
                          // colors, not by fading the whole cell (which took its
                          // text under 4.5:1).
                          s
                            ? "border-transparent"
                            : removed
                            ? "border-dashed border-warning/60 bg-warning/5"
                            : approved
                            ? "border-success/40 bg-success/10"
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
                            {/* Time off (approved, or requested with a "?") leads, so a narrow cell that cuts the
                                line short still shows it. */}
                            <span className="block text-[11px] font-semibold truncate" style={{ color: clash ? "var(--status-warn)" : color }}>
                              <span className="sr-only">, </span>
                              {approved ? (partDay ? `Off${partDayText} · ` : "Time off · ") : requested ? (partDay ? `Off${partDayText}? · ` : "Time off? · ") : ""}
                              {isLiveContext ? tag : tag ? `${tag}${type ? ` · ${SHIFT_LABEL[type]}` : ""}` : type ? SHIFT_LABEL[type] : "Shift"}
                            </span>
                          </>
                        ) : removed ? (
                          <>
                            <span className="block text-[12px] leading-tight font-semibold tabular-nums text-fg-muted line-through">
                              {shortTime(cell.live!.startMinutes)}–{shortTime(cell.live!.endMinutes)}
                            </span>
                            <span className="block text-[11px] font-semibold text-warning-fg">Removed</span>
                          </>
                        ) : approved ? (
                          <span className="block text-[11px] font-semibold text-success-fg-strong">{partDay ? `Off${partDayText}` : "Time off approved"}</span>
                        ) : requested ? (
                          <span className="block text-[11px] font-semibold text-fg-muted">{partDay ? `Off${partDayText}?` : "Time off requested"}</span>
                        ) : (
                          <span aria-hidden="true" className="block text-center text-lg text-fg-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">+</span>
                        )}
                        <span className="sr-only">{context}</span>
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
