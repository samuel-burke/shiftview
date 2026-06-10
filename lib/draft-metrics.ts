import type { StoreHours } from "@/data/types";

/** A shift-like record — works for both drafts and published schedules. */
export type ShiftSpan = {
  date: string; // YYYY-MM-DD
  startMinutes: number;
  endMinutes: number;
};

export type UnderstaffedAlert = {
  date: string;
  startMinutes: number;
  endMinutes: number;
  shortfall: number; // how many people short at the worst point in the range
};

const SLOT = 30; // minutes per coverage slot

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

export function shiftHours(s: { startMinutes: number; endMinutes: number }): number {
  return (s.endMinutes - s.startMinutes) / 60;
}

export function scheduledHoursForDate(shifts: ShiftSpan[], date: string): number {
  return shifts
    .filter((s) => s.date.slice(0, 10) === date)
    .reduce((sum, s) => sum + shiftHours(s), 0);
}

export function headcountAt(shifts: ShiftSpan[], date: string, minute: number): number {
  return shifts.filter(
    (s) => s.date.slice(0, 10) === date && minute >= s.startMinutes && minute < s.endMinutes
  ).length;
}

/** Recommended staff-hours for one day: optimal headcount across all open hours. */
export function recommendedHoursForDay(hours: StoreHours | undefined, optimalCoverage: number): number {
  if (!hours || hours.close <= hours.open) return 0;
  return (optimalCoverage * (hours.close - hours.open)) / 60;
}

/**
 * Percentage (0–100) of 30-minute open slots across the given dates where
 * scheduled headcount meets the minimum coverage. Null when nothing is open.
 */
export function coverageScore(
  shifts: ShiftSpan[],
  dates: string[],
  storeHours: Record<number, StoreHours>,
  minCoverage: number
): number | null {
  let total = 0;
  let covered = 0;
  for (const date of dates) {
    const hours = storeHours[dayOfWeek(date)];
    if (!hours || hours.close <= hours.open) continue;
    for (let t = hours.open; t < hours.close; t += SLOT) {
      total++;
      if (headcountAt(shifts, date, t) >= minCoverage) covered++;
    }
  }
  if (total === 0) return null;
  return Math.round((covered / total) * 100);
}

/** Contiguous open-hour ranges where scheduled headcount falls below the minimum. */
export function findUnderstaffedRanges(
  shifts: ShiftSpan[],
  dates: string[],
  storeHours: Record<number, StoreHours>,
  minCoverage: number
): UnderstaffedAlert[] {
  const alerts: UnderstaffedAlert[] = [];
  for (const date of dates) {
    const hours = storeHours[dayOfWeek(date)];
    if (!hours || hours.close <= hours.open) continue;
    let rangeStart: number | null = null;
    let worst = 0;
    for (let t = hours.open; t <= hours.close; t += SLOT) {
      const count = t < hours.close ? headcountAt(shifts, date, t) : Infinity;
      if (count < minCoverage) {
        if (rangeStart === null) { rangeStart = t; worst = count; }
        else worst = Math.min(worst, count);
      } else if (rangeStart !== null) {
        alerts.push({ date, startMinutes: rangeStart, endMinutes: t, shortfall: minCoverage - worst });
        rangeStart = null;
      }
    }
  }
  return alerts;
}
