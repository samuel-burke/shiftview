"use client";

import type { IncidentSeverity } from "../lib/incident";

export type Incident = {
  id: number;
  employeeName: string | null;
  date: string;
  severity: IncidentSeverity;
  description: string;
};

const SEVERITY_META: Record<IncidentSeverity, { label: string; cls: string }> = {
  minor:    { label: "Minor",    cls: "text-slate-300 bg-slate-700/40" },
  moderate: { label: "Moderate", cls: "text-amber-300 bg-amber-500/20" },
  severe:   { label: "Severe",   cls: "text-red-300 bg-red-500/20" },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

// Manager-only incident log. Presentational — the parent fetches /api/incidents
// (a manager-gated route).
export default function IncidentLog({ incidents }: { incidents: Incident[] }) {
  return (
    <div data-testid="incident-log" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Incident Log</span>
        <span className="text-[10px] text-slate-500" aria-hidden="true">🔒 managers</span>
      </div>

      {incidents.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No incidents reported</div>
      ) : (
        incidents.map((i) => {
          const meta = SEVERITY_META[i.severity];
          return (
            <div key={i.id} data-testid={`incident-${i.id}`} className="rounded-xl bg-card border border-slate-800/60 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-100">
                  {formatDate(i.date)}{i.employeeName ? ` · ${i.employeeName}` : ""}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${meta.cls}`}>
                  {meta.label}
                </span>
              </div>
              <div className="text-sm text-slate-300 mt-0.5 whitespace-pre-wrap">{i.description}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
