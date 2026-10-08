// The Week page keeps its mode and week in the URL, e.g.
// /week?mode=draft&week=2026-10-11, so a reload or a shared link opens the
// same view. Live opens on this week; Draft with no week opens on next week,
// the week you'd usually plan. A week param is snapped to its week's start.

import { addDaysToKey, isDateKey, weekStartForKey } from "@/lib/dates";

export type WeekMode = "live" | "draft";

type Params = { get(name: string): string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultWeekStart(mode: WeekMode, todayKey: string, firstDayOfWeek: number): string {
  const thisWeek = weekStartForKey(todayKey, firstDayOfWeek);
  return mode === "draft" ? addDaysToKey(thisWeek, 7) : thisWeek;
}

export function parseWeekParams(
  params: Params,
  todayKey: string,
  firstDayOfWeek: number
): { mode: WeekMode; weekStart: string } {
  const mode: WeekMode = params.get("mode") === "draft" ? "draft" : "live";
  const week = params.get("week");
  if (week && DATE_RE.test(week) && isDateKey(week)) return { mode, weekStart: weekStartForKey(week, firstDayOfWeek) };
  return { mode, weekStart: defaultWeekStart(mode, todayKey, firstDayOfWeek) };
}

export function weekHref(mode: WeekMode, weekStart: string): string {
  const query = new URLSearchParams();
  if (mode === "draft") query.set("mode", "draft");
  query.set("week", weekStart);
  return `/week?${query}`;
}
