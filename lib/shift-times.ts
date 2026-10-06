// Shift times, including overnight shifts.
//
// A shift belongs to the store-local date it *starts* on. Its times are
// minutes since that date's midnight: startMinutes is 0–1439, and endMinutes
// may run past 1440 into the next day — a 10 PM–6 AM shift is 1320–1800. That
// keeps durations simple (end − start) and lets lib/dates convert any time to
// an instant (zonedTimeToUtc rolls minutes past 1440 into the next day).

import { addDaysToKey, daysBetweenKeys } from "@/lib/dates";

export const MIN_SHIFT_MINUTES = 60;
export const MAX_SHIFT_MINUTES = 960; // 16 hours (BR-3)
export const DAY_MINUTES = 1440;

// Returns an error message, or null when the times are valid.
export function validateShiftTimes(startMinutes: unknown, endMinutes: unknown): string | null {
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes))
    return "startMinutes and endMinutes must be integers";
  const start = startMinutes as number;
  const end = endMinutes as number;
  if (start < 0 || start >= DAY_MINUTES) return "startMinutes must be between 0 and 1439";
  if (end <= start) return "startMinutes must be less than endMinutes (an overnight shift ends after 1440)";
  if (end - start < MIN_SHIFT_MINUTES) return "shift must be at least 1 hour";
  if (end - start > MAX_SHIFT_MINUTES) return "shift cannot exceed 16 hours";
  return null;
}

export function isOvernight(s: { endMinutes: number }): boolean {
  return s.endMinutes > DAY_MINUTES;
}

type DatedShift = { date: string; startMinutes: number; endMinutes: number };

// The shift's times relative to `dayKey`'s midnight. A 10 PM–6 AM shift that
// started yesterday is −120–360 today.
export function shiftWindowOn(s: DatedShift, dayKey: string): { start: number; end: number } {
  const offset = DAY_MINUTES * daysBetweenKeys(dayKey, s.date.slice(0, 10));
  return { start: s.startMinutes + offset, end: s.endMinutes + offset };
}

// True when any part of the shift falls on `dayKey`.
export function shiftTouchesDay(s: DatedShift, dayKey: string): boolean {
  const { start, end } = shiftWindowOn(s, dayKey);
  return start < DAY_MINUTES && end > 0;
}

// True while `minute` (minutes since `dayKey`'s midnight) is inside the shift.
export function isWorkingAt(s: DatedShift, dayKey: string, minute: number): boolean {
  const { start, end } = shiftWindowOn(s, dayKey);
  return minute >= start && minute < end;
}

// The shift split into its per-day parts, as minutes within each day:
// [{ date, start, end }] — one part, or two for an overnight shift.
export function shiftParts(s: DatedShift): { date: string; start: number; end: number }[] {
  const date = s.date.slice(0, 10);
  if (s.endMinutes <= DAY_MINUTES) return [{ date, start: s.startMinutes, end: s.endMinutes }];
  return [
    { date, start: s.startMinutes, end: DAY_MINUTES },
    { date: addDaysToKey(date, 1), start: 0, end: s.endMinutes - DAY_MINUTES },
  ];
}

// Whether two shifts overlap in time (half-open: touching ends don't overlap).
export function shiftsOverlap(a: DatedShift, b: DatedShift): boolean {
  const aw = shiftWindowOn(a, a.date.slice(0, 10));
  const bw = shiftWindowOn(b, a.date.slice(0, 10));
  return aw.start < bw.end && bw.start < aw.end;
}

// "HH:MM" pickers ↔ minutes. An end time at or before the start time means the
// next day (10:00 PM → 6:00 AM is an overnight shift).
export function minutesFromTimeInputs(start: string, end: string): { startMinutes: number; endMinutes: number } {
  const toMin = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    return h * 60 + m;
  };
  const startMinutes = toMin(start);
  let endMinutes = toMin(end);
  if (endMinutes <= startMinutes) endMinutes += DAY_MINUTES;
  return { startMinutes, endMinutes };
}

export function timeInputFromMinutes(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
