// Time-off requests: whole days, part days ("leaving at 3") and multi-day
// requests. A multi-day request is stored as one row per day sharing a
// group_id, so every reader that works per day (the week board, conflicts,
// Auto-schedule) keeps working; approving or denying acts on the whole group.

import { addDaysToKey, daysBetweenKeys, isDateKey } from "@/lib/dates";
import { shiftParts } from "@/lib/shift-times";
import { fmtMinutes } from "@/data/types";

// Longest multi-day request, in days (inclusive).
export const MAX_TIME_OFF_DAYS = 31;
// Shortest part-day request.
export const MIN_PART_DAY_MINUTES = 15;

export type TimeOffWindow = { startMinutes: number; endMinutes: number } | null;

/** A row's part-day window, or null for the whole day. */
export function timeOffWindow(row: { start_minutes?: number | null; end_minutes?: number | null }): TimeOffWindow {
  return row.start_minutes == null || row.end_minutes == null
    ? null
    : { startMinutes: row.start_minutes, endMinutes: row.end_minutes };
}

/** Whether time off (whole day = null) overlaps [start, end) within that day. */
export function timeOffOverlaps(window: TimeOffWindow, start: number, end: number): boolean {
  if (!window) return true;
  return start < window.endMinutes && window.startMinutes < end;
}

export type TimeOffRequestInput = {
  date: string;
  endDate: string;
  window: TimeOffWindow;
};

/**
 * Validates a request body's dates and times: `date`, optional `endDate`
 * (inclusive, for several days), optional `startMinutes`/`endMinutes` (a part
 * day; only for a single day). Returns the parsed request or an error message.
 */
export function parseTimeOffRequest(
  body: Record<string, unknown>,
  today: string
): { request: TimeOffRequestInput; error: null } | { request: null; error: string } {
  const { date, endDate, startMinutes, endMinutes } = body;
  if (!isDateKey(date)) return { request: null, error: "date must be YYYY-MM-DD" };
  const last = endDate === undefined || endDate === null || endDate === "" ? date : endDate;
  if (!isDateKey(last)) return { request: null, error: "endDate must be YYYY-MM-DD" };
  if (date < today) return { request: null, error: "date must be today or in the future" };
  if (last < date) return { request: null, error: "endDate must not be before date" };
  if (daysBetweenKeys(date, last) + 1 > MAX_TIME_OFF_DAYS)
    return { request: null, error: `A request can cover at most ${MAX_TIME_OFF_DAYS} days` };

  const partDay = startMinutes != null || endMinutes != null;
  if (!partDay) return { request: { date, endDate: last, window: null }, error: null };

  if (last !== date) return { request: null, error: "A part-day request covers a single day" };
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes))
    return { request: null, error: "startMinutes and endMinutes must both be whole minutes" };
  const s = startMinutes as number;
  const e = endMinutes as number;
  if (s < 0 || e > 1440 || e - s < MIN_PART_DAY_MINUTES)
    return { request: null, error: "The time off must end after it starts, within the day" };
  if (s === 0 && e === 1440) return { request: { date, endDate: last, window: null }, error: null };
  return { request: { date, endDate: last, window: { startMinutes: s, endMinutes: e } }, error: null };
}

/** Every date a request covers, in order. */
export function requestDates(req: { date: string; endDate: string }): string[] {
  const out: string[] = [];
  for (let d = req.date; d <= req.endDate; d = addDaysToKey(d, 1)) out.push(d);
  return out;
}

export type ScheduledShift = { id: number; employeeId: number; date: string; startMinutes: number; endMinutes: number };
export type TimeOffDay = { date: string; window: TimeOffWindow };

/** The shifts that fall in any of the time-off days (overnight shifts count on both days they touch). */
export function shiftsDuringTimeOff(shifts: ScheduledShift[], days: TimeOffDay[]): ScheduledShift[] {
  const byDate = new Map(days.map((d) => [d.date.slice(0, 10), d.window]));
  return shifts.filter((s) =>
    shiftParts(s).some((p) => byDate.has(p.date) && timeOffOverlaps(byDate.get(p.date) ?? null, p.start, p.end))
  );
}

/** "Mon, Oct 20", "Oct 20 – Oct 24", or "Mon, Oct 20, 3:00 PM – 6:00 PM". */
export function describeTimeOff(dates: string[], window: TimeOffWindow): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  const sorted = [...dates].map((d) => d.slice(0, 10)).sort();
  if (sorted.length === 0) return "";
  if (sorted.length === 1) {
    const day = fmt(sorted[0], { weekday: "short", month: "short", day: "numeric" });
    return window ? `${day}, ${fmtMinutes(window.startMinutes)} – ${fmtMinutes(window.endMinutes)}` : day;
  }
  return `${fmt(sorted[0], { month: "short", day: "numeric" })} – ${fmt(sorted[sorted.length - 1], { month: "short", day: "numeric" })}`;
}

/**
 * One entry per request: the days of a multi-day request (same groupId)
 * become one, dated by its first day, with `endDate` and `days`. Input order
 * by date is kept.
 */
export function collapseTimeOffGroups<T extends { date: string; groupId?: string | null }>(
  rows: T[]
): (T & { endDate: string; days: number })[] {
  const out: (T & { endDate: string; days: number })[] = [];
  const byGroup = new Map<string, T & { endDate: string; days: number }>();
  for (const r of [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const date = String(r.date).slice(0, 10);
    if (!r.groupId) {
      out.push({ ...r, endDate: date, days: 1 });
      continue;
    }
    const seen = byGroup.get(r.groupId);
    if (seen) {
      seen.endDate = date;
      seen.days += 1;
      continue;
    }
    const entry = { ...r, endDate: date, days: 1 };
    byGroup.set(r.groupId, entry);
    out.push(entry);
  }
  return out;
}

/** The reverse of collapseTimeOffGroups: one entry per day, for views that work by day. */
export function expandTimeOffRequests<T extends { date: string; endDate?: string | null }>(rows: T[]): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const first = String(r.date).slice(0, 10);
    const last = r.endDate ? String(r.endDate).slice(0, 10) : first;
    for (let d = first; d <= last; d = addDaysToKey(d, 1)) out.push({ ...r, date: d });
  }
  return out;
}
