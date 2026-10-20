"use client";

import { useState } from "react";
import type { PunchHistoryEntry } from "@/app/api/punches/[id]/history/route";
import { formatDateKey, dateKeyInTz, formatTimeInTz } from "@/lib/dates";

const LABELS: Record<string, string> = {
  clock_in: "Clock In",
  clock_out: "Clock Out",
  break_start: "Break Start",
  break_end: "Break End",
};

function when(iso: string, tz: string): string {
  return `${formatDateKey(dateKeyInTz(iso, tz), { month: "short", day: "numeric" })}, ${formatTimeInTz(iso, tz)}`;
}

function describe(e: PunchHistoryEntry, tz: string): string {
  const who = e.changedBy ?? "The system";
  if (e.action === "insert") return `${who} added this punch`;
  if (e.action === "delete") return `${who} deleted this punch`;
  const parts: string[] = [];
  if (e.before && e.after && e.before.punchType !== e.after.punchType)
    parts.push(`was ${LABELS[e.before.punchType] ?? e.before.punchType}`);
  if (e.before && e.after && e.before.punchedAt !== e.after.punchedAt)
    parts.push(`was ${formatTimeInTz(e.before.punchedAt, tz)}`);
  return `${who} edited this punch${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

// A small "Manual" marker on a punch that, when opened, loads and lists who
// added or changed it, when, why, and what it was before
// (GET /api/punches/[id]/history). Loaded on demand: most punches are never
// opened, and a list shouldn't make a request per row.
export default function PunchHistoryToggle({
  punchId,
  timezone,
  className,
  label = "Manual",
  title = "Manual punch — show who changed it",
}: {
  punchId: number;
  timezone: string;
  className?: string;
  label?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PunchHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || entries) return;
    setFailed(false);
    try {
      const res = await fetch(`/api/punches/${punchId}/history`);
      const json = await res.json();
      if (!res.ok || !Array.isArray(json.history)) throw new Error();
      setEntries(json.history);
    } catch {
      setFailed(true);
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={title}
        className={className ?? "text-[10px] font-semibold text-accent-fg bg-accent/10 px-2 py-px rounded-full cursor-pointer"}
      >
        {label} {open ? "▴" : "▾"}
      </button>
      {open && (
        <span className="block mt-1 text-[11px] text-fg-muted max-w-[260px]" data-testid="punch-history">
          {failed ? (
            "Couldn't load this punch's history"
          ) : !entries ? (
            "Loading…"
          ) : entries.length === 0 ? (
            "No changes recorded (edits from before history was kept aren't listed)"
          ) : (
            entries.map((e) => (
              <span key={e.id} className="block">
                {describe(e, timezone)} · {when(e.changedAt, timezone)}
                {e.reason && <span className="block text-fg-subtle italic">“{e.reason}”</span>}
              </span>
            ))
          )}
        </span>
      )}
    </span>
  );
}
