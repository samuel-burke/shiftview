"use client";

import { useEffect, useReducer } from "react";
import { localDayBoundsUtc, todayKeyInTz } from "@/lib/dates";

// Today's date (YYYY-MM-DD) in the store's timezone. Re-renders the caller at
// the store's midnight — and whenever the tab becomes visible again, since a
// sleeping device can skip timers — so "today" never goes stale on a page left
// open overnight, whatever timezone the device itself is in.
export function useStoreTodayKey(tz: string): string {
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  const key = todayKeyInTz(tz);

  useEffect(() => {
    const msUntilMidnight = localDayBoundsUtc(key, tz).end.getTime() + 1 - Date.now();
    // setTimeout overflows above 2^31-1 ms; a small floor avoids a busy loop.
    const delay = Math.min(Math.max(msUntilMidnight + 500, 1_000), 2_147_483_647);
    const timer = setTimeout(recheck, delay);
    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, tz]);

  return key;
}
