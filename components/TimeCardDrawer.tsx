"use client";

import { useState, useEffect, useCallback } from "react";
import { fmtMinutes, type PunchType } from "@/data/types";
import type { Timecard, ViolationType } from "@/lib/timecard";

type Props = {
  open: boolean;
  employee: { id: number; name: string } | null;
  timezone: string;
  onClose: () => void;
};

const PUNCH_LABELS: Record<PunchType, string> = {
  clock_in: "Clock In",
  clock_out: "Clock Out",
  break_start: "Break Start",
  break_end: "Break End",
};

const PUNCH_COLORS: Record<PunchType, string> = {
  clock_in: "#22c55e",
  clock_out: "#94a3b8",
  break_start: "#f59e0b",
  break_end: "#818cf8",
};

// Per-violation pill styling. Hard violations (NCNS, late, no-show-shaped) are
// red; softer timing deviations are amber.
const VIOLATION_STYLES: Record<ViolationType, { label: string; className: string }> = {
  late_in:     { label: "Late In",     className: "bg-red-500/15 text-red-400 border border-red-500/25" },
  late_out:    { label: "Late Out",    className: "bg-amber-500/15 text-amber-400 border border-amber-500/25" },
  early_in:    { label: "Early In",    className: "bg-amber-500/15 text-amber-400 border border-amber-500/25" },
  early_out:   { label: "Early Out",   className: "bg-amber-500/15 text-amber-400 border border-amber-500/25" },
  long_break:  { label: "Long Break",  className: "bg-orange-500/15 text-orange-400 border border-orange-500/25" },
  short_break: { label: "Short Break", className: "bg-orange-500/15 text-orange-400 border border-orange-500/25" },
  callout:     { label: "Call Out",    className: "bg-rose-500/15 text-rose-400 border border-rose-500/25" },
  ncns:        { label: "No Call No Show", className: "bg-red-600/20 text-red-300 border border-red-500/40" },
};

function todayKey(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDayHeader(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function formatPunchTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
  });
}

export default function TimeCardDrawer({ open, employee, timezone, onClose }: Props) {
  const [from, setFrom] = useState(() => addDays(todayKey(timezone), -13));
  const [to, setTo] = useState(() => todayKey(timezone));
  const [data, setData] = useState<Timecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (empId: number, fromDate: string, toDate: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/timecard?employeeId=${empId}&from=${fromDate}&to=${toDate}`
        );
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Failed to load time card");
          setData(null);
          return;
        }
        setData(json as Timecard);
      } catch {
        setError("Network error — please try again");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // (Re)load whenever the drawer opens for an employee.
  useEffect(() => {
    if (open && employee) load(employee.id, from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id]);

  // Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function applyRange() {
    if (employee && from <= to) load(employee.id, from, to);
  }

  function exportCSV() {
    if (!employee) return;
    const a = document.createElement("a");
    a.href = `/api/timecard?employeeId=${employee.id}&from=${from}&to=${to}&format=csv`;
    a.download = `timecard_${employee.name.replace(/\s+/g, "_")}_${from}_to_${to}.csv`;
    a.click();
  }

  const counts = data?.violationCounts;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 bg-black/60 z-[60] transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={employee ? `Time card for ${employee.name}` : "Time card"}
        className={`fixed inset-y-0 right-0 z-[70] w-full max-w-[560px] bg-bg border-l border-slate-800 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 border-b border-slate-800 shrink-0"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)", paddingBottom: 16 }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-slate-100 truncate">
              {employee?.name ?? "Time Card"}
            </div>
            <div className="text-[11px] text-slate-500">Time card · punches & violations</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-10 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center shrink-0 hover:bg-slate-700 hover:text-slate-200 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Date range controls */}
        <div className="px-5 py-3 border-b border-slate-800 shrink-0 flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[120px]">
            <label htmlFor="tc-from" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">From</label>
            <input
              id="tc-from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-card border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label htmlFor="tc-to" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">To</label>
            <input
              id="tc-to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-card border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70"
            />
          </div>
          <button
            onClick={applyRange}
            disabled={loading || from > to}
            className="py-1.5 px-3 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "…" : "Apply"}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} aria-hidden="true" className="h-20 bg-slate-800 rounded-2xl animate-pulse" />
              ))}
            </div>
          )}

          {!loading && data && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-card rounded-xl border border-white/[0.05] px-3 py-2.5 text-center">
                  <div className="text-[20px] font-extrabold text-slate-100 tabular-nums leading-none">
                    {data.totalWorkedHours.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Hours</div>
                </div>
                <div className="bg-card rounded-xl border border-white/[0.05] px-3 py-2.5 text-center">
                  <div className="text-[20px] font-extrabold text-slate-100 tabular-nums leading-none">
                    {data.totalBreakHours.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Break</div>
                </div>
                <div className="bg-card rounded-xl border border-white/[0.05] px-3 py-2.5 text-center">
                  <div className={`text-[20px] font-extrabold tabular-nums leading-none ${data.totalViolations > 0 ? "text-red-400" : "text-slate-100"}`}>
                    {data.totalViolations}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Flags</div>
                </div>
              </div>

              {/* Violation breakdown chips */}
              {counts && data.totalViolations > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {(Object.keys(counts) as ViolationType[])
                    .filter((t) => counts[t] > 0)
                    .map((t) => (
                      <span
                        key={t}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${VIOLATION_STYLES[t].className}`}
                      >
                        {VIOLATION_STYLES[t].label} · {counts[t]}
                      </span>
                    ))}
                </div>
              )}

              {/* Per-day cards */}
              {data.days.length === 0 ? (
                <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-10 text-center">
                  <div className="text-slate-400 text-sm font-medium">Nothing recorded in this period</div>
                  <div className="text-slate-500 text-xs mt-1">No shifts, punches, or call-outs for these dates</div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.days.map((day) => (
                    <div key={day.date} className="bg-card rounded-2xl border border-slate-800/60 px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-sm font-bold text-slate-100">{formatDayHeader(day.date)}</div>
                        <div className="text-[11px] text-slate-400">
                          {day.schedule
                            ? `${fmtMinutes(day.schedule.startMinutes)} – ${fmtMinutes(day.schedule.endMinutes)}`
                            : "Unscheduled"}
                        </div>
                      </div>

                      {/* Violations */}
                      {day.violations.length > 0 && (
                        <div className="flex flex-col gap-1 mb-2">
                          {day.violations.map((v, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${VIOLATION_STYLES[v.type].className}`}>
                                {v.label}
                              </span>
                              <span className="text-[11px] text-slate-400">{v.detail}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Punches */}
                      {day.punches.length > 0 ? (
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {day.punches.map((p) => (
                            <div key={p.id} className="flex items-center gap-1.5 text-[11px]">
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full shrink-0"
                                style={{ background: PUNCH_COLORS[p.punchType] }}
                              />
                              <span className="text-slate-400">{PUNCH_LABELS[p.punchType]}</span>
                              <span className="text-slate-200 font-semibold tabular-nums">
                                {formatPunchTime(p.punchedAt, data.timezone)}
                              </span>
                              {p.isManual && (
                                <span className="text-[9px] text-amber-400/80 uppercase" title="Manual correction">✎</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        !day.callout && <div className="text-[11px] text-slate-500 italic">No punches</div>
                      )}

                      {/* Hours footer */}
                      {(day.workedHours > 0 || day.breakHours > 0 || day.hasIncomplete) && (
                        <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center gap-3 text-[11px] text-slate-400">
                          <span className="font-semibold text-slate-300 tabular-nums">{day.workedHours.toFixed(2)}h worked</span>
                          {day.breakHours > 0 && <span className="tabular-nums">{day.breakHours.toFixed(2)}h break</span>}
                          {day.hasIncomplete && (
                            <span className="text-amber-400" title="Missing a clock-out or break-end">⚠ incomplete</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — export */}
        {data && data.days.length > 0 && (
          <div
            className="px-5 border-t border-slate-800 shrink-0"
            style={{ paddingTop: 12, paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          >
            <button
              onClick={exportCSV}
              className="w-full py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm cursor-pointer hover:bg-slate-700 transition-colors"
            >
              Export CSV
            </button>
          </div>
        )}
      </div>
    </>
  );
}
