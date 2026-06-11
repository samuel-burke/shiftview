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
