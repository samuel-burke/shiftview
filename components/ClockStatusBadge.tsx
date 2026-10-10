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

// The two longest labels; which one is wider depends on the font.
const LONG_LABELS = ["Clocked In", "On Break"] as const;

export default function ClockStatusBadge({ variant = "pill" }: { variant?: "pill" | "dot" }) {
  const { liveStatus } = useAppData();
  const s = STATUS[liveStatus] ?? STATUS.not_clocked_in;

  // Dot-only form for the narrow nav rail; the label stays available to screen readers.
  if (variant === "dot") {
    return (
      <span
        role="status"
        aria-label={s.label}
        title={s.label}
        className="block size-2.5 rounded-full"
        style={{ background: s.color, boxShadow: s.live ? `0 0 6px ${s.color}` : "none" }}
      />
    );
  }

  // The pill is as wide as its longest label in every state, so the status
  // arriving (Off → Clocked In) doesn't push the header's other buttons.
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
      {/* ::before and ::after hold the longest labels, invisible, in the same
          grid cell as the shown one, so the pill is always the widest width.
          (CSS content, so the hidden labels aren't in the page's text.) */}
      <span
        data-long-a={LONG_LABELS[0]}
        data-long-b={LONG_LABELS[1]}
        className="grid text-xs font-semibold leading-none whitespace-nowrap before:col-start-1 before:row-start-1 before:invisible before:content-[attr(data-long-a)] after:col-start-1 after:row-start-1 after:invisible after:content-[attr(data-long-b)]"
      >
        <span className="col-start-1 row-start-1" style={{ color: s.color }}>{s.label}</span>
      </span>
    </div>
  );
}
