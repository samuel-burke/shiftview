"use client";

import { useAppData } from "@/lib/AppDataContext";
import type { AttendanceStatus } from "@/data/types";

/*
 * Compact clock-status indicator for the app header: a color-coded status dot
 * with a short label. Reads the shared live attendance status (kept in sync
 * across devices by AppDataContext), so it reflects the user's clock state at
 * a glance from any screen — a lightweight replacement for the old full-screen
 * ambient ring.
 */

const STATUS: Record<AttendanceStatus, { color: string; label: string; live: boolean }> = {
  clocked_in:     { color: "#22c55e", label: "Clocked In", live: true },
  on_break:       { color: "#f59e0b", label: "On Break",   live: true },
  clocked_out:    { color: "#94a3b8", label: "Off",        live: false },
  not_clocked_in: { color: "#94a3b8", label: "Off",        live: false },
};

export default function ClockStatusBadge() {
  const { liveStatus } = useAppData();
  const s = STATUS[liveStatus] ?? STATUS.not_clocked_in;

  return (
    <div
      role="status"
      aria-label={s.label}
      className="flex items-center gap-1.5 rounded-full bg-card border border-slate-800/70 pl-2 pr-2.5 py-1"
    >
      <span
        aria-hidden="true"
        className="size-2 rounded-full shrink-0"
        style={{ background: s.color, boxShadow: s.live ? `0 0 6px ${s.color}` : "none" }}
      />
      <span className="text-xs font-semibold leading-none whitespace-nowrap" style={{ color: s.color }}>
        {s.label}
      </span>
    </div>
  );
}
