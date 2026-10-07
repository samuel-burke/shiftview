// When an employee may call out (an unplanned absence): only for a shift they
// are scheduled for today or tomorrow — store-local days — and not for today's
// shift once they've clocked in for it. Shared by POST /api/callouts and the
// screens that offer the button, and mirrored in the database by the
// enforce_callout_rules() trigger (supabase/migrations/0032_callout_rules.sql).

import { addDaysToKey } from "@/lib/dates";

export type CalloutCheck = {
  date: string;            // YYYY-MM-DD the employee wants to call out for
  todayKey: string;        // today in the store's timezone
  hasShift: boolean;       // scheduled on `date`
  clockedInToday: boolean; // has clocked in at any point on the store's today
};

// Returns why the call-out isn't allowed, or null when it is.
export function calloutBlockReason({ date, todayKey, hasShift, clockedInToday }: CalloutCheck): string | null {
  if (date !== todayKey && date !== addDaysToKey(todayKey, 1))
    return "You can only call out for today's or tomorrow's shift";
  if (!hasShift)
    return "You don't have a shift scheduled that day";
  if (date === todayKey && clockedInToday)
    return "You've already clocked in for today's shift";
  return null;
}
