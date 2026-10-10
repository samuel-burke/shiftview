"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { mapSwap, type RawSwap, type Swap } from "@/lib/swaps";
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
 * Drops the item with `id` from a list now; the returned function puts it
 * back at the same place (if it isn't there again already).
 */
export function removeOptimistically<T extends { id: number }>(
  setList: (update: (prev: T[]) => T[]) => void,
  id: number,
): () => void {
  let removed: { item: T; index: number } | null = null;
  setList((prev) => {
    const index = prev.findIndex((x) => x.id === id);
    if (index === -1) return prev;
    removed = { item: prev[index], index };
    return prev.filter((x) => x.id !== id);
  });
  return () => {
    const r = removed;
    if (!r) return;
    setList((prev) => (prev.some((x) => x.id === id) ? prev : [...prev.slice(0, r.index), r.item, ...prev.slice(r.index)]));
  };
}

/**
 * Everything awaiting a manager's decision — time off, shift swaps the other
 * employee already accepted, and missed-punch corrections — kept live via
 * Supabase realtime and a refetch when the tab comes back into view.
 *
 * `enabled` should be the caller's manager flag; nothing loads until it's true.
 * Approve/deny actions throw with a readable message on failure.
 * `beforeRefresh` runs just before a background refresh (realtime, return to
 * the tab) changes the lists — e.g. a scroll anchor's preserve().
 */
export function useManagerRequests(enabled: boolean, beforeRefresh?: () => void) {
  const beforeRefreshRef = useRef(beforeRefresh);
  useEffect(() => { beforeRefreshRef.current = beforeRefresh; });
  const [timeOff, setTimeOff] = useState<ManagerTimeOff[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [corrections, setCorrections] = useState<PunchCorrection[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (background = false) => {
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [t, s, c] = await Promise.all([get("/api/time-off"), get("/api/swaps"), get("/api/punch-corrections")]);
    if (background) beforeRefreshRef.current?.();
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
      else if (Date.now() - hiddenAt > 5_000) load(true);
    }
    document.addEventListener("visibilitychange", onVisibility);

    const supabase = createClient();
    const channel = supabase
      .channel("manager-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_swaps" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "punch_corrections" }, () => load(true))
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [enabled, load]);

  // Only swaps the target already accepted wait on a manager.
  const managerSwaps = useMemo(() => swaps.filter((s) => s.status === "accepted"), [swaps]);
  const pendingCorrections = useMemo(() => corrections.filter((c) => c.status === "pending"), [corrections]);

  // Decisions are optimistic: the request leaves its list at the tap (so the
  // list changes then, not a round trip later under the manager's finger)
  // and goes back where it was if the server refuses.
  const decideTimeOff = useCallback(async (id: number, status: "approved" | "denied") => {
    const restore = removeOptimistically(setTimeOff, id);
    try {
      await putStatus(`/api/time-off/${id}`, status, `Couldn't ${status === "approved" ? "approve" : "deny"} the time off request.`);
    } catch (e) {
      restore();
      throw e;
    }
  }, []);

  const decideSwap = useCallback(async (id: number, status: "approved" | "denied") => {
    removeOptimistically(setSwaps, id);
    try {
      await putStatus(`/api/swaps/${id}`, status, `Couldn't ${status === "approved" ? "approve" : "deny"} the swap.`);
    } catch (e) {
      load(); // the swap may have changed underneath us; resync
      throw e;
    }
  }, [load]);

  const decideCorrection = useCallback(async (id: number, status: "approved" | "denied") => {
    const restore = removeOptimistically(setCorrections, id);
    try {
      await putStatus(`/api/punch-corrections/${id}`, status, `Couldn't ${status === "approved" ? "approve" : "deny"} the correction.`);
    } catch (e) {
      restore();
      throw e;
    }
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
