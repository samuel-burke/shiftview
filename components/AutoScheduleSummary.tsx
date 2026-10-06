"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { fmtMinutes, formatDisplayName, type Employee } from "../data/types";
import { dayOfWeek } from "../lib/draft-metrics";
import type { GapReasonCode, GenerationRun, SchedulerWarning, Suggestion } from "../lib/scheduler/types";

// What the last Auto-schedule run did for the week, what it couldn't cover and
// why, and one-tap ways to improve it. Stays until the week is published, the
// run is undone, or the card is dismissed.

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLLAPSED_GAPS = 3;

const REASON_LABELS: Record<GapReasonCode, string> = {
  time_off: "time off",
  unavailable: "unavailable",
  has_shift_that_day: "already working that day",
  max_hours: "at their weekly hours",
  max_days: "at their days per week",
  consecutive_days: "too many days in a row",
  rest: "not enough rest between shifts",
  no_fit: "no allowed shift fits",
  pending_time_off: "asked for the day off",
  short_gap: "gap shorter than the shortest shift",
  tradeoff: "would cost more than it covers",
};

export type SummaryBusy = "undo" | "another" | "suggestion" | null;

function names(ids: number[], nameOf: (id: number) => string, max = 3): string {
  const shown = ids.slice(0, max).map(nameOf);
  return ids.length > max ? `${shown.join(", ")} +${ids.length - max}` : shown.join(", ");
}

function warningText(w: SchedulerWarning, nameOf: (id: number) => string): string {
  switch (w.code) {
    case "no_coverage_target":
      return `No coverage target on ${w.dates.map((d) => DAY_SHORT[dayOfWeek(d)]).join(", ")}, so nobody was scheduled then.`;
    case "employment_type_missing":
      return w.employeeIds.length === 1
        ? "1 person has no employment type and was scheduled as part-time."
        : `${w.employeeIds.length} people have no employment type and were scheduled as part-time.`;
    case "over_budget":
      return `${w.hours} h over the coverage budget. Full-time minimum hours come first.`;
    case "pending_time_off_scheduled":
      // No closing period: names end in an initial's ("Jordan K.").
      return `Scheduled on a day they asked off (pending): ${names(w.employeeIds, nameOf)}`;
    case "time_limit":
      return "Stopped early to stay fast. Try another version for a different result.";
  }
}

function suggestionLabel(s: Suggestion, nameOf: (id: number) => string): string {
  return s.overtime
    ? `Allow ${nameOf(s.employeeId)} ${s.maxHours} h (overtime)`
    : `Let ${nameOf(s.employeeId)} work up to ${s.maxHours} h`;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-bold text-slate-100 tabular-nums truncate">{value}</div>
      <div className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</div>
      {detail && <div className="text-[11px] text-slate-500">{detail}</div>}
    </div>
  );
}

export default function AutoScheduleSummary({
  run,
  employees,
  busy,
  error,
  onUndo,
  onTryAnother,
  onApplySuggestion,
  onDismiss,
}: {
  run: GenerationRun;
  employees: Employee[];
  busy: SummaryBusy;
  error: string | null;
  onUndo: () => void;
  onTryAnother: () => void;
  onApplySuggestion: (s: Suggestion) => void;
  onDismiss: () => void;
}) {
  const [showAllGaps, setShowAllGaps] = useState(false);
  const nameOf = useMemo(() => {
    const byId = new Map(employees.map((e) => [e.id, formatDisplayName(e.name)]));
    return (id: number) => byId.get(id) ?? "Someone";
  }, [employees]);

  const m = run.metrics;
  const fmtPct = (p: number | null) => (p === null ? "—" : `${p}%`);
  const gaps = showAllGaps ? run.gaps : run.gaps.slice(0, COLLAPSED_GAPS);
  const created = new Date(run.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <motion.section
      data-testid="auto-schedule-summary"
      aria-labelledby="auto-summary-title"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-3 tablet:mx-6 bg-card rounded-2xl border border-violet-500/30 px-4 py-3.5"
      style={{ background: "linear-gradient(180deg, rgba(139,92,246,0.06), transparent 60%)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="auto-summary-title" className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
            <span aria-hidden="true">✨</span> Auto-scheduled {m.generatedShifts} shift{m.generatedShifts === 1 ? "" : "s"}
          </h2>
          <div className="text-[11px] text-slate-400">
            {run.mode === "fill" ? "Around your drafts" : "Started fresh"} · {created}
            {run.adjustments.length > 0 && ` · ${run.adjustments.length} adjustment${run.adjustments.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss summary"
          className="size-10 -mt-1.5 -mr-2 rounded-lg bg-transparent border-none text-slate-500 hover:text-slate-300 cursor-pointer flex items-center justify-center shrink-0"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="grid grid-cols-3 tablet:grid-cols-5 gap-3 mt-3">
        <Stat label="Coverage" value={`${fmtPct(m.coverageScoreBefore)} → ${fmtPct(m.coverageScore)}`} />
        <Stat label="Hours / budget" value={`${m.scheduledHours} / ${m.budgetHours}`} />
        <Stat label="Overtime" value={`${m.overtimeHours} h`} />
        <Stat
          label="Labor cost"
          // $0 only because nobody has a pay rate would read as free.
          value={m.laborCost === 0 && m.employeesMissingRate > 0 ? "—" : `$${Math.round(m.laborCost).toLocaleString()}`}
          detail={m.employeesMissingRate > 0 ? `${m.employeesMissingRate} without a rate` : undefined}
        />
        <Stat label="Preferences" value={fmtPct(m.preferenceScore)} />
      </div>

      {run.warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {run.warnings.map((w) => (
            <li key={w.code} className="flex items-start gap-1.5 text-xs text-amber-400">
              <span aria-hidden="true">⚠</span>
              <span>{warningText(w, nameOf)}</span>
            </li>
          ))}
        </ul>
      )}

      {run.gaps.length > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-1.5">
            {run.gaps.length} gap{run.gaps.length === 1 ? "" : "s"} left
          </div>
          <ul className="flex flex-col gap-2">
            {gaps.map((g) => (
              <li key={`${g.date}-${g.startMinutes}`} className="text-xs">
                <div className="text-slate-200 font-semibold tabular-nums">
                  {DAY_SHORT[dayOfWeek(g.date)]} {fmtMinutes(g.startMinutes)}–{fmtMinutes(g.endMinutes)}
                  <span className="text-red-400 font-normal"> · short {g.shortfall}</span>
                </div>
                <div className="text-slate-400">
                  {g.reasons.length === 0
                    ? "Nobody on the roster"
                    : g.reasons.map((r) => `${r.employeeIds.length > 3 ? `${r.employeeIds.length} people` : names(r.employeeIds, nameOf)}: ${REASON_LABELS[r.code]}`).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
          {run.gaps.length > COLLAPSED_GAPS && (
            <button
              onClick={() => setShowAllGaps((v) => !v)}
              aria-expanded={showAllGaps}
              className="mt-0.5 min-h-8 text-xs font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer p-0"
            >
              {showAllGaps ? "Show fewer" : `Show all ${run.gaps.length}`}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 text-xs text-emerald-400">✓ Every hour of the coverage target is met.</div>
      )}

      {run.suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {run.suggestions.map((s) => (
            <button
              key={s.employeeId}
              onClick={() => onApplySuggestion(s)}
              disabled={busy !== null}
              className="min-h-9 text-xs font-semibold px-3 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {suggestionLabel(s, nameOf)}
            </button>
          ))}
        </div>
      )}

      {error && <div role="alert" className="mt-3 text-xs text-red-400">{error}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onTryAnother}
          disabled={busy !== null}
          aria-busy={busy === "another" || busy === "suggestion"}
          className="min-h-10 text-xs font-semibold px-4 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === "another" || busy === "suggestion" ? "Generating…" : "Try Another Version"}
        </button>
        <button
          onClick={onUndo}
          disabled={busy !== null}
          aria-busy={busy === "undo"}
          className="min-h-10 text-xs font-semibold px-4 rounded-lg bg-transparent border border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === "undo" ? "Undoing…" : "Undo"}
        </button>
      </div>
    </motion.section>
  );
}
