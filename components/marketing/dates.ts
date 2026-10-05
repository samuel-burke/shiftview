"use client";

import { useSyncExternalStore } from "react";

// The marketing pages are prerendered, so any date on them would be frozen at
// build time. These helpers read the visitor's own clock after hydration
// instead: the server snapshot is null, and the client re-renders with today.

const noop = () => () => {};

/** Today's date (local midnight) on the client; null during SSR and hydration. */
export function useToday(): Date | null {
  const key = useSyncExternalStore(noop, () => new Date().toDateString(), () => null);
  return key ? new Date(key) : null;
}

export function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Sunday of the week containing `d`. */
export function startOfWeek(d: Date) {
  return addDays(d, -d.getDay());
}

/** The next date on or after `from` that falls on `dow` (0 = Sunday). */
export function nextWeekday(from: Date, dow: number) {
  return addDays(from, (dow - from.getDay() + 7) % 7);
}

export const fmtShort = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const fmtDayShort = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const fmtLong = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
export const fmtRange = (a: Date, b: Date, withYear = false) =>
  `${fmtShort(a)} – ${fmtShort(b)}${withYear ? `, ${b.getFullYear()}` : ""}`;
