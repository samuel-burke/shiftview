"use client";

import { useAppData } from "@/lib/AppDataContext";
import type { AttendanceStatus } from "@/data/types";

/*
 * Clock-status indicator for the app header and nav: a status dot in the
 * state's color and an icon for the state: a clock when clocked in, a cup on
 * break, the same clock crossed out when off. Reads the shared live
 * attendance status (kept in sync across devices by AppDataContext). The
 * state's name is the indicator's accessible name and its tooltip.
 *
 * Every state is the same size, so the status arriving or changing doesn't
 * move the header's other buttons.
 */

function ClockIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BreakIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M8 3.5v2M12 3.5v2" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function OffIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 19.5l15-15" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const STATUS: Record<AttendanceStatus, { color: string; label: string; Icon: typeof ClockIcon }> = {
  clocked_in:     { color: "var(--status-ok)",    label: "Clocked In", Icon: ClockIcon },
  on_break:       { color: "var(--status-warn)",  label: "On Break",   Icon: BreakIcon },
  clocked_out:    { color: "var(--status-muted)", label: "Off",        Icon: OffIcon },
  not_clocked_in: { color: "var(--status-muted)", label: "Off",        Icon: OffIcon },
};

export default function ClockStatusBadge() {
  const { liveStatus } = useAppData();
  const s = STATUS[liveStatus] ?? STATUS.not_clocked_in;

  return (
    <div role="status" aria-label={s.label} title={s.label} className="flex items-center gap-1.5 h-4">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
      <s.Icon color={s.color} />
    </div>
  );
}
