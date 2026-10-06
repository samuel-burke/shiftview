import { shiftMinutes } from "@/lib/schedule-hours";
import { isWorkingAt } from "@/lib/shift-times";

/** A shift-like record — works for both drafts and published schedules. */
export type ShiftSpan = {
  date: string; // YYYY-MM-DD
  startMinutes: number;
  endMinutes: number;
};

/** The 7 YYYY-MM-DD dates starting at weekStart. Noon anchor avoids DST edge cases. */
export function weekDates(weekStart: string): string[] {
  const base = new Date(weekStart + "T12:00:00Z");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function dayOfWeek(date: string): number {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

// Hours of a shift; with the store timezone, real elapsed hours (DST-aware).
export function shiftHours(s: { startMinutes: number; endMinutes: number; date?: string }, tz?: string): number {
  return shiftMinutes(s, tz) / 60;
}

export function scheduledHoursForDate(shifts: ShiftSpan[], date: string, tz?: string): number {
  return shifts
    .filter((s) => s.date.slice(0, 10) === date)
    .reduce((sum, s) => sum + shiftHours(s, tz), 0);
}

// Includes the after-midnight part of the previous day's overnight shifts.
export function headcountAt(shifts: ShiftSpan[], date: string, minute: number): number {
  return shifts.filter((s) => isWorkingAt(s, date, minute)).length;
}
