// Availability rules, shared by manual scheduling (lib/shift-conflicts-server.ts)
// and the auto-scheduler (lib/scheduler): per weekday, either a window or
// unavailable all day. A weekday with no rule is available all day.

export type AvailabilityRule = {
  // Both null = unavailable all day.
  startMinutes: number | null;
  endMinutes: number | null;
};

export function isUnavailableAllDay(rule: AvailabilityRule): boolean {
  return rule.startMinutes === null || rule.endMinutes === null;
}

// Whether [start, end), in minutes within one day, fits that day's rule.
export function fitsAvailability(rule: AvailabilityRule | null | undefined, start: number, end: number): boolean {
  if (!rule) return true;
  if (isUnavailableAllDay(rule)) return false;
  return start >= rule.startMinutes! && end <= rule.endMinutes!;
}
