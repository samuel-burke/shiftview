"use client";

import { useEffect, useState } from "react";
import { useAppData } from "@/lib/AppDataContext";
import { isStatusRingEnabled, STATUS_RING_EVENT } from "@/lib/status-ring-preference";

/*
 * Ambient clock-status ring.
 *
 * A soft, edge-of-screen glow that signals the user's live clock status at a
 * glance from any screen — no need to open the time clock to check. It is
 * intentionally peripheral and only appears while a shift is active:
 *
 *   • Clocked in  → green glow
 *   • On break    → amber glow
 *   • Clocked out / not clocked in → nothing (so it never nags off-shift)
 *
 * The colors mirror the time-clock status pill. The element is purely
 * decorative (aria-hidden) and never intercepts taps (pointer-events: none).
 * It can be turned off per-device in Settings.
 */

const RING: Record<string, { color: string; className: string } | null> = {
  clocked_in: { color: "#22c55e", className: "status-ring status-ring-green" },
  on_break:   { color: "#f59e0b", className: "status-ring status-ring-amber" },
  clocked_out: null,
  not_clocked_in: null,
};

export default function ClockStatusRing() {
  const { liveStatus } = useAppData();

  // Device-local opt-out. Initialized after mount (localStorage isn't available
  // during SSR) and kept live so toggling it in Settings is instant.
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    setEnabled(isStatusRingEnabled());
    function onChange(e: Event) {
      setEnabled((e as CustomEvent<boolean>).detail);
    }
    window.addEventListener(STATUS_RING_EVENT, onChange);
    return () => window.removeEventListener(STATUS_RING_EVENT, onChange);
  }, []);

  const ring = RING[liveStatus];
  if (!enabled || !ring) return null;

  return (
    <div
      aria-hidden="true"
      className={ring.className}
      style={{ ["--ring-color" as string]: ring.color }}
    />
  );
}
