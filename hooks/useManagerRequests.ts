"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { mapSwap, type RawSwap, type Swap } from "@/lib/swaps";
import { useStoreTodayKey } from "@/hooks/useStoreTodayKey";
import type { PunchCorrection } from "@/app/api/punch-corrections/route";

/** A pending time-off request as the manager's GET /api/time-off returns it. */
export type ManagerTimeOff = {
  id: number;
  employeeId: number;
  employeeName: string;
  date: string;
  note?: string;
  status: string;
};

async function putStatus(url: string, status: string, fallback: string) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw new Error(error ?? fallback);
  }
}

/**
 * Everything awaiting a manager's decision — time off, shift swaps the other
 * employee already accepted, and missed-punch corrections — kept live via
 * Supabase realtime and a refetch when the tab comes back into view. Time off
 * and swaps expire once their day arrives, so the list is also refetched at
 * the store's midnight (in `timezone`).
 *
 * `enabled` should be the caller's manager flag; nothing loads until it's true.
 * Approve/deny actions throw with a readable message on failure.
 */
export function useManagerRequests(enabled: boolean, timezone: string) {
  const storeDay = useStoreTodayKey(timezone);
  const [timeOff, setTimeOff] = useState<ManagerTimeOff[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [corrections, setCorrections] = useState<PunchCorrection[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [t, s, c] = await Promise.all([get("/api/time-off"), get("/api/swaps"), get("/api/punch-corrections")]);
    if (t && Array.isArray(t.requests)) setTimeOff(t.requests);
    if (Array.isArray(s)) setSwaps((s as RawSwap[]).map(mapSwap));
    if (c && Array.isArray(c.corrections)) setCorrections(c.corrections);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Initial load; later updates arrive through realtime / visibility below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();

    let hiddenAt = 0;
    function onVisibility() {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (Date.now() - hiddenAt > 5_000) load();
    }
    document.addEventListener("visibilitychange", onVisibility);

    const supabase = createClient();
    const channel = supabase
      .channel("manager-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_swaps" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "punch_corrections" }, load)
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [enabled, load, storeDay]);

  // Only swaps the target already accepted wait on a manager.
  const managerSwaps = useMemo(() => swaps.filter((s) => s.status === "accepted"), [swaps]);
  const pendingCorrections = useMemo(() => corrections.filter((c) => c.status === "pending"), [corrections]);

  const decideTimeOff = useCallback(async (id: number, status: "approved" | "denied") => {
    await putStatus(`/api/time-off/${id}`, status, `Couldn't ${status === "approved" ? "approve" : "deny"} the time off request.`);
    setTimeOff((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const decideSwap = useCallback(async (id: number, status: "approved" | "denied") => {
    try {
      await putStatus(`/api/swaps/${id}`, status, `Couldn't ${status === "approved" ? "approve" : "deny"} the swap.`);
      setSwaps((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      load(); // the swap may have changed underneath us; resync
      throw e;
    }
  }, [load]);

  const decideCorrection = useCallback(async (id: number, status: "approved" | "denied") => {
    await putStatus(`/api/punch-corrections/${id}`, status, `Couldn't ${status === "approved" ? "approve" : "deny"} the correction.`);
    setCorrections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return {
    loaded,
    timeOff,
    swaps: managerSwaps,
    corrections: pendingCorrections,
    count: timeOff.length + managerSwaps.length + pendingCorrections.length,
    reload: load,
    decideTimeOff,
    decideSwap,
    decideCorrection,
  };
}
