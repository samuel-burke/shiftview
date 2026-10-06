"use client";

import {
  Employee,
  Schedule,
  StoreHours,
  TimeOffRequest,
  getShiftType,
  getMonogram,
  formatDisplayName,
  SHIFT_COLORS,
} from "../data/types";
import { dayOfWeekForKey, formatDateKey } from "@/lib/dates";
import { shortTime } from "./WeekView";

/** A pending time-off request as the manager's GET /api/time-off returns it. */
export type PendingTimeOff = TimeOffRequest & { employeeId: number };

type Props = {
  employees: Employee[];
  /** Every shift in the week, any employee. */
  schedules: Schedule[];
  /** The seven store-local date keys, in display order. */
  dates: string[];
  weeklyHours: Record<number, StoreHours>;
  todayKey: string;
  timeOff?: PendingTimeOff[];
  selected?: { employeeId: number; date: string } | null;
  onSelect: (employee: Employee, date: string, schedule: Schedule | null) => void;
};

const SHIFT_LABEL = { opener: "Opener", mid: "Mid", closer: "Closer" } as const;

function shiftHours(s: Schedule): number {
  return Math.max(0, s.endMinutes - s.startMinutes) / 60;
}

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
  timeOff = [],
  selected = null,
  onSelect,
}: Props) {
  const byCell = new Map<string, Schedule>();
  for (const s of schedules) byCell.set(`${s.employeeId}|${s.date.slice(0, 10)}`, s);
  const timeOffCell = new Set(timeOff.map((t) => `${t.employeeId}|${t.date}`));

  const dayTotals = dates.map((date) => {
    const day = schedules.filter((s) => s.date.slice(0, 10) === date);
    return { people: new Set(day.map((s) => s.employeeId)).size, hours: day.reduce((n, s) => n + shiftHours(s), 0) };
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
              return (
                <th
                  key={date}
                  scope="col"
                  aria-current={isToday ? "date" : undefined}
                  className={`px-1.5 py-3 text-center ${isToday ? "bg-indigo-500/10" : ""}`}
                >
                  <div className={`text-[11px] font-semibold uppercase tracking-wider ${isToday ? "text-indigo-300" : "text-slate-400"}`}>
                    {formatDateKey(date, { weekday: "short" })}
                  </div>
                  <div className={`text-sm font-bold tabular-nums ${isToday ? "text-indigo-300" : "text-slate-200"}`}>
                    {formatDateKey(date, { month: "short", day: "numeric" })}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {employees.map((emp) => {
            const weekly = dates.reduce((n, d) => {
              const s = byCell.get(`${emp.id}|${d}`);
              return n + (s ? shiftHours(s) : 0);
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
                  const s = byCell.get(`${emp.id}|${date}`) ?? null;
                  const hours = weeklyHours[dayOfWeekForKey(date)];
                  const type = s && hours ? getShiftType(s.startMinutes, s.endMinutes, hours.open, hours.close) : null;
                  const color = type ? SHIFT_COLORS[type] : "#94a3b8";
                  const requested = timeOffCell.has(`${emp.id}|${date}`);
                  const isSel = selected?.employeeId === emp.id && selected.date === date;
                  const dayLabel = formatDateKey(date, { weekday: "long", month: "long", day: "numeric" });
                  const label = s
                    ? `${emp.name}, ${dayLabel}: ${type ? SHIFT_LABEL[type] + " " : ""}${shortTime(s.startMinutes)} to ${shortTime(s.endMinutes)}${requested ? ", time off requested" : ""}`
                    : `${emp.name}, ${dayLabel}: off${requested ? ", time off requested" : ""}. Add a shift`;
                  return (
                    <td key={date} className={`p-1 align-middle ${date === todayKey ? "bg-indigo-500/5" : ""}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(emp, date, s)}
                        aria-label={label}
                        aria-pressed={isSel}
                        className={`group relative w-full h-12 rounded-lg text-left px-2 transition-colors cursor-pointer border ${
                          isSel ? "ring-2 ring-indigo-400 ring-offset-1 ring-offset-bg" : ""
                        } ${
                          s
                            ? "border-transparent"
                            : requested
                            ? "border-dashed border-slate-500 bg-transparent"
                            : "border-transparent hover:border-slate-700 hover:bg-slate-800/60 focus-visible:border-slate-700"
                        }`}
                        style={s ? { background: `color-mix(in srgb, ${color} 18%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` } : undefined}
                      >
                        {s ? (
                          <>
                            <span className="block text-[12px] font-semibold text-slate-100 tabular-nums truncate">
                              {shortTime(s.startMinutes)}–{shortTime(s.endMinutes)}
                            </span>
                            <span className="block text-[10px] font-semibold truncate" style={{ color }}>
                              {type ? SHIFT_LABEL[type] : "Shift"}{requested ? " · Time off?" : ""}
                            </span>
                          </>
                        ) : requested ? (
                          <span className="block text-[10px] font-semibold text-slate-400">Time off requested</span>
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
              Scheduled
              <span className="block normal-case tracking-normal text-sm font-bold text-slate-200 tabular-nums">{fmtHours(weekHours)} hrs</span>
            </th>
            {dayTotals.map((t, i) => (
              <td key={dates[i]} className="px-1.5 py-3 text-center align-bottom">
                <div className="mx-auto mb-1.5 h-10 w-6 flex items-end" aria-hidden="true">
                  <div className="w-full rounded-t bg-blue-500/70" style={{ height: `${(t.hours / maxHours) * 100}%` }} />
                </div>
                <div className="text-[12px] font-bold text-slate-200 tabular-nums">{fmtHours(t.hours)}h</div>
                <div className="text-[10px] text-slate-500 tabular-nums">{t.people} {t.people === 1 ? "person" : "people"}</div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
