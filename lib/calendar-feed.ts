// An employee's shifts as an iCalendar document: the one-time download
// (/api/my-schedule/calendar) and the subscribable feed
// (/api/calendar/<token>), which calendar apps re-fetch on their own so the
// phone calendar follows schedule changes.
//
// A feed URL is a bearer secret: anyone with it can read that person's
// shifts. Only its SHA-256 hash is stored (calendar_feeds.token_hash), the
// person can replace or turn it off, and it only ever shows their own shifts.

import { createHash, randomBytes } from "node:crypto";
import { fmtMinutes } from "@/data/types";
import { buildShiftCalendar, type ShiftEvent } from "@/lib/ics";
import { addDaysToKey, todayKeyInTz } from "@/lib/dates";

// How wide a window of shifts the calendar carries.
export const CALENDAR_PAST_DAYS = 30;
export const CALENDAR_FUTURE_DAYS = 120;

type QueryClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function newFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Tokens are 43 base64url characters; anything else is refused before a lookup.
export function isFeedTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function feedPath(token: string): string {
  return `/api/calendar/${token}.ics`;
}

/** The employee's shifts in the calendar window, as an .ics document. */
export async function buildEmployeeCalendar(
  supabase: QueryClient,
  { orgId, employee, timezone, now = new Date(), refreshMinutes }: { orgId: string; employee: { id: number; name: string }; timezone: string; now?: Date; refreshMinutes?: number }
): Promise<{ ics: string; error: unknown }> {
  const today = todayKeyInTz(timezone, now);
  const { data, error } = await supabase
    .from("schedules")
    .select("id, date, start_minutes, end_minutes, note")
    .eq("org_id", orgId)
    .eq("employee_id", employee.id)
    .gte("date", addDaysToKey(today, -CALENDAR_PAST_DAYS))
    .lte("date", addDaysToKey(today, CALENDAR_FUTURE_DAYS))
    .order("date");
  if (error) return { ics: "", error };

  const events: ShiftEvent[] = ((data ?? []) as { id: number; date: string; start_minutes: number; end_minutes: number; note?: string | null }[]).map((s) => ({
    // Stable UID keyed on the schedule row id so re-importing (or the next
    // feed refresh) updates the same event instead of creating a duplicate.
    uid: `shiftview-${s.id}-${orgId}@shiftview.app`,
    date: String(s.date).slice(0, 10),
    startMinutes: s.start_minutes,
    endMinutes: s.end_minutes,
    summary: `Shift · ${fmtMinutes(s.start_minutes)}–${fmtMinutes(s.end_minutes)}`,
    description: s.note ? `${employee.name}'s shift\n${s.note}` : `${employee.name}'s shift`,
  }));

  return {
    ics: buildShiftCalendar(events, { calendarName: `${employee.name} — Shifts`, dtstamp: now, timezone, refreshMinutes }),
    error: null,
  };
}
