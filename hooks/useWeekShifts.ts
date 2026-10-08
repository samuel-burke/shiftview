"use client";

import { useCallback, useEffect, useState } from "react";
import type { Schedule } from "@/data/types";
import type { ShiftSource, SourcedShift } from "@/lib/week-cells";

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

export function useWeekShifts({ enabled, dates, apiFetch }: { enabled: boolean; dates: string[]; apiFetch: ApiFetch }) {
  const weekStart = dates[0];
  const weekEnd = dates[dates.length - 1];
  const [live, setLive] = useState<SourcedShift[]>([]);
  const [drafts, setDrafts] = useState<SourcedShift[]>([]);
  // The week whose shifts are loaded; while it differs from weekStart, the page is loading.
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Drafts can't load (e.g. the draft tables are missing). Live still works.
  const [draftsUnavailable, setDraftsUnavailable] = useState(false);

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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.allSettled([fetchLive(), fetchDrafts()]).then(([l, d]) => {
      if (cancelled) return;
      setLive(l.status === "fulfilled" ? l.value : []);
      setError(l.status === "fulfilled" ? null : (l.reason as Error).message);
      setDrafts(d.status === "fulfilled" ? d.value : []);
      setDraftsUnavailable(d.status === "rejected");
      setLoadedWeek(weekStart);
    });
    return () => { cancelled = true; };
  }, [enabled, weekStart, fetchLive, fetchDrafts]);

  const reloadLive = useCallback(async () => setLive(await fetchLive()), [fetchLive]);
  const reloadDrafts = useCallback(async () => setDrafts(await fetchDrafts()), [fetchDrafts]);

  async function send(source: ShiftSource, init: RequestInit, fallback: string) {
    const res = await apiFetch(source === "draft" ? "/api/drafts" : "/api/schedules", {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) await throwApiError(res, fallback);
    await (source === "draft" ? reloadDrafts() : reloadLive());
  }

  return {
    live,
    drafts,
    loading: loadedWeek !== weekStart,
    error,
    draftsUnavailable,
    reloadLive,
    reloadDrafts,
    // After publishing: the drafts that went live are gone and live shifts grew.
    reloadAll: useCallback(async () => {
      const [l, d] = await Promise.all([fetchLive(), fetchDrafts()]);
      setLive(l);
      setDrafts(d);
    }, [fetchLive, fetchDrafts]),
    save: (source: ShiftSource, id: number, startMinutes: number, endMinutes: number, override = false) =>
      send(source, { method: "PUT", body: JSON.stringify({ id, startMinutes, endMinutes, override }) }, "Failed to save shift"),
    create: (source: ShiftSource, employeeId: number, date: string, startMinutes: number, endMinutes: number, override = false) =>
      send(source, { method: "POST", body: JSON.stringify({ employeeId, date, startMinutes, endMinutes, override }) }, "Failed to add shift"),
    remove: (source: ShiftSource, id: number) =>
      send(source, { method: "DELETE", body: JSON.stringify({ id }) }, source === "draft" ? "Failed to remove draft" : "Failed to mark as off"),
  };
}
