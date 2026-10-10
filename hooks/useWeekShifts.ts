"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Schedule } from "@/data/types";
import type { ShiftSource, SourcedShift } from "@/lib/week-cells";
import { addDaysToKey } from "@/lib/dates";

const NONE: SourcedShift[] = [];

// The Week page's shifts for one week: the live (published) ones and the
// drafts, both loaded whatever the mode (Draft lays drafts over the live
// shifts; Live shows the draft count on its toggle). Edits go to the table the
// shift belongs to: /api/schedules for live, /api/drafts for drafts.

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Throws an Error carrying conflict metadata (time off, availability) from a 409. */
export async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  if (body.conflict) {
    throw Object.assign(new Error(body.message ?? "Conflict"), {
      conflict: body.conflict,
      window: body.window ?? null,
    });
  }
  throw new Error(body.error ?? fallback);
}

function tag(rows: unknown, source: ShiftSource): SourcedShift[] {
  return (Array.isArray(rows) ? (rows as Schedule[]) : []).map((s) => ({ ...s, date: String(s.date).slice(0, 10), source }));
}

type WeekData = { live: SourcedShift[]; drafts: SourcedShift[]; error: string | null; draftsUnavailable: boolean };

export function useWeekShifts({ enabled, dates, apiFetch }: { enabled: boolean; dates: string[]; apiFetch: ApiFetch }) {
  const weekStart = dates[0];
  const weekEnd = dates[dates.length - 1];
  // Loaded weeks by their first day. The shown week reads from here during
  // render, so a week that's already loaded (or was prefetched as a
  // neighbour) shows in the same frame as the tap; one that isn't is loading.
  const [weeks, setWeeks] = useState<Record<string, WeekData>>({});
  const current = weeks[weekStart];

  const fetchWeek = useCallback(async (start: string): Promise<WeekData> => {
    const end = addDaysToKey(start, 6);
    const [l, d] = await Promise.allSettled([
      apiFetch(`/api/schedules?from=${start}&to=${end}`).then(async (res) => {
        if (!res.ok) throw new Error("Couldn't load this week's shifts. Refresh to try again.");
        return tag(await res.json(), "live");
      }),
      apiFetch(`/api/drafts?weekStart=${start}`).then(async (res) => {
        if (!res.ok) throw new Error("Couldn't load this week's drafts.");
        return tag(await res.json(), "draft");
      }),
    ]);
    return {
      live: l.status === "fulfilled" ? l.value : [],
      error: l.status === "fulfilled" ? null : (l.reason as Error).message,
      drafts: d.status === "fulfilled" ? d.value : [],
      draftsUnavailable: d.status === "rejected",
    };
  }, [apiFetch]);

  const fetchLive = useCallback(async () => {
    const res = await apiFetch(`/api/schedules?from=${weekStart}&to=${weekEnd}`);
    if (!res.ok) throw new Error("Couldn't load this week's shifts. Refresh to try again.");
    return tag(await res.json(), "live");
  }, [apiFetch, weekStart, weekEnd]);

  const fetchDrafts = useCallback(async () => {
    const res = await apiFetch(`/api/drafts?weekStart=${weekStart}`);
    if (!res.ok) throw new Error("Couldn't load this week's drafts.");
    return tag(await res.json(), "draft");
  }, [apiFetch, weekStart]);

  const patchWeek = useCallback((start: string, patch: Partial<WeekData>) => {
    setWeeks((prev) => (prev[start] ? { ...prev, [start]: { ...prev[start], ...patch } } : prev));
  }, []);

  // The shown week is (re)loaded on every visit; the weeks either side once,
  // ahead of a step to them.
  const prefetched = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchWeek(weekStart).then((data) => {
      if (cancelled) return;
      setWeeks((prev) => ({ ...prev, [weekStart]: data }));
      for (const near of [addDaysToKey(weekStart, -7), addDaysToKey(weekStart, 7)]) {
        if (prefetched.current.has(near)) continue;
        prefetched.current.add(near);
        fetchWeek(near).then((d) => setWeeks((prev) => (prev[near] ? prev : { ...prev, [near]: d })));
      }
    });
    return () => { cancelled = true; };
  }, [enabled, weekStart, fetchWeek]);

  const reloadLive = useCallback(async () => {
    const live = await fetchLive();
    patchWeek(weekStart, { live });
  }, [fetchLive, patchWeek, weekStart]);
  const reloadDrafts = useCallback(async () => {
    const drafts = await fetchDrafts();
    patchWeek(weekStart, { drafts });
  }, [fetchDrafts, patchWeek, weekStart]);

  async function send(source: ShiftSource, init: RequestInit, fallback: string) {
    const res = await apiFetch(source === "draft" ? "/api/drafts" : "/api/schedules", {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) await throwApiError(res, fallback);
    await (source === "draft" ? reloadDrafts() : reloadLive());
  }

  return {
    live: current?.live ?? NONE,
    drafts: current?.drafts ?? NONE,
    loading: !current,
    error: current?.error ?? null,
    draftsUnavailable: current?.draftsUnavailable ?? false,
    reloadLive,
    reloadDrafts,
    // After publishing: the drafts that went live are gone and live shifts grew.
    reloadAll: useCallback(async () => {
      const [live, drafts] = await Promise.all([fetchLive(), fetchDrafts()]);
      patchWeek(weekStart, { live, drafts });
    }, [fetchLive, fetchDrafts, patchWeek, weekStart]),
    save: (source: ShiftSource, id: number, startMinutes: number, endMinutes: number, override = false) =>
      send(source, { method: "PUT", body: JSON.stringify({ id, startMinutes, endMinutes, override }) }, "Failed to save shift"),
    create: (source: ShiftSource, employeeId: number, date: string, startMinutes: number, endMinutes: number, override = false) =>
      send(source, { method: "POST", body: JSON.stringify({ employeeId, date, startMinutes, endMinutes, override }) }, "Failed to add shift"),
    remove: (source: ShiftSource, id: number) =>
      send(source, { method: "DELETE", body: JSON.stringify({ id }) }, source === "draft" ? "Failed to remove draft" : "Failed to mark as off"),
  };
}
