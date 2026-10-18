"use client";

import { useState, useEffect, useCallback } from "react";
import { fmtMinutes, type PunchType } from "@/data/types";
import type { Timecard, ViolationType } from "@/lib/timecard";
import type { PayrollWeek } from "@/lib/payroll";
import { addDaysToKey, formatDateKey, formatTimeInTz, todayKeyInTz } from "@/lib/dates";
import { useScrollLock } from "@/lib/scroll-lock";
import StableLabel from "./StableLabel";
import PunchHistoryToggle from "./PunchHistoryToggle";

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
  clock_in: "var(--status-ok-mark)",
  clock_out: "var(--status-muted)",
  break_start: "var(--status-warn-mark)",
  break_end: "var(--status-info)",
};

// Per-violation pill styling. Hard violations (NCNS, late, no-show-shaped) are
// red; softer timing deviations are amber.
const VIOLATION_STYLES: Record<ViolationType, { label: string; className: string }> = {
  late_in:     { label: "Late In",     className: "bg-danger/15 text-danger-fg border border-danger/25" },
  late_out:    { label: "Late Out",    className: "bg-warning/15 text-warning-fg border border-warning/25" },
  early_in:    { label: "Early In",    className: "bg-warning/15 text-warning-fg border border-warning/25" },
  early_out:   { label: "Early Out",   className: "bg-warning/15 text-warning-fg border border-warning/25" },
  long_break:  { label: "Long Break",  className: "bg-attention/15 text-attention-fg border border-attention/25" },
  short_break: { label: "Short Break", className: "bg-attention/15 text-attention-fg border border-attention/25" },
  callout:     { label: "Call Out",    className: "bg-tag-rose/15 text-tag-rose-fg border border-tag-rose/25" },
  ncns:        { label: "No Call No Show", className: "bg-danger-solid/20 text-danger-fg-strong border border-danger/40" },
};

// What /api/timecard returns: the time card plus its workweeks split by the
// org's pay rules. The extra fields are optional so a bare Timecard (the home
// page's demo) still renders.
export type TimeCardData = Timecard & { weeks?: PayrollWeek[]; exempt?: boolean };

const todayKey = todayKeyInTz;
const addDays = addDaysToKey;

function formatDayHeader(dateStr: string): string {
  return formatDateKey(dateStr, { weekday: "short", month: "short", day: "numeric" });
}

function formatPunchTime(iso: string, tz: string): string {
  return formatTimeInTz(iso, tz);
}

export default function TimeCardDrawer({ open, employee, timezone, onClose }: Props) {
  const [from, setFrom] = useState(() => addDays(todayKey(timezone), -13));
  const [to, setTo] = useState(() => todayKey(timezone));
  const [data, setData] = useState<TimeCardData | null>(null);
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
        setData(json as TimeCardData);
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

  useScrollLock(open);

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

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 bg-scrim/60 z-[60] transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={employee ? `Time card for ${employee.name}` : "Time card"}
        className={`fixed inset-y-0 right-0 z-[70] w-full max-w-[560px] bg-bg border-l border-line flex flex-col transition-[transform,visibility] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0 visible" : "translate-x-full invisible"
        }`}
      >
        <TimeCardPanel
          employee={employee}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          onApply={applyRange}
          onClose={onClose}
          onExport={exportCSV}
          data={data}
          loading={loading}
          error={error}
        />
      </div>
    </>
  );
}

/**
 * The time card itself: header, date range, the summary and each day's
 * punches, and the export. The drawer above supplies its state; the home
 * page's demo renders it with sample data. Returns the column's children, so
 * the caller's flex column lays them out.
 */
export function TimeCardPanel({
  employee,
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
  onClose,
  onExport,
  data,
  loading,
  error,
}: {
  employee: { id: number; name: string } | null;
  from: string;
  to: string;
  onFromChange: (date: string) => void;
  onToChange: (date: string) => void;
  onApply: () => void;
  onClose: () => void;
  onExport: () => void;
  data: TimeCardData | null;
  loading: boolean;
  error: string | null;
}) {
  const counts = data?.violationCounts;
  return (
    <>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 border-b border-line shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)", paddingBottom: 16 }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-fg truncate">
            {employee?.name ?? "Time Card"}
          </div>
          <div className="text-[11px] text-fg-subtle">Time card · punches & violations</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="size-11 rounded-full bg-fill border-none text-fg-muted cursor-pointer flex items-center justify-center shrink-0 hover:bg-fill-strong hover:text-fg-body transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Date range controls: the fields and Apply share one height. */}
      <div className="px-5 py-3 border-b border-line shrink-0 flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[120px]">
          <label htmlFor="tc-from" className="text-[10px] text-fg-subtle font-semibold uppercase mb-1 block">From</label>
          <input
            id="tc-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => onFromChange(e.target.value)}
            className="w-full h-11 bg-card border border-field rounded-lg px-2 text-xs text-fg-body focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label htmlFor="tc-to" className="text-[10px] text-fg-subtle font-semibold uppercase mb-1 block">To</label>
          <input
            id="tc-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => onToChange(e.target.value)}
            className="w-full h-11 bg-card border border-field rounded-lg px-2 text-xs text-fg-body focus:outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={onApply}
          disabled={loading || from > to}
          className="h-11 px-4 rounded-lg bg-accent-solid text-on-accent text-xs font-semibold cursor-pointer hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <StableLabel labels={["Apply", "…"]} active={loading ? 1 : 0} />
        </button>
      </div>

      {/* Body */}
      <div data-testid="timecard-body" className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div role="alert" className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 text-sm text-danger-fg">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} aria-hidden="true" className="h-20 bg-fill rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {!loading && data && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-card rounded-xl border border-line-subtle px-3 py-2.5 text-center">
                <div className="text-[20px] font-extrabold text-fg tabular-nums leading-none">
                  {data.totalWorkedHours.toFixed(1)}
                </div>
                <div className="text-[10px] text-fg-muted mt-1 uppercase tracking-wide">Hours</div>
              </div>
              <div className="bg-card rounded-xl border border-line-subtle px-3 py-2.5 text-center">
                <div className="text-[20px] font-extrabold text-fg tabular-nums leading-none">
                  {data.totalBreakHours.toFixed(1)}
                </div>
                <div className="text-[10px] text-fg-muted mt-1 uppercase tracking-wide">Break</div>
              </div>
              <div className="bg-card rounded-xl border border-line-subtle px-3 py-2.5 text-center">
                <div className={`text-[20px] font-extrabold tabular-nums leading-none ${data.totalViolations > 0 ? "text-danger-fg" : "text-fg"}`}>
                  {data.totalViolations}
                </div>
                <div className="text-[10px] text-fg-muted mt-1 uppercase tracking-wide">Flags</div>
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

            {/* Workweeks as payroll pays them: regular, overtime, double time */}
            {data.weeks && data.weeks.length > 0 && (
              <div className="bg-card rounded-2xl border border-line/60 px-4 py-3 mb-4" data-testid="timecard-pay-weeks">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] text-fg-muted font-semibold uppercase tracking-wide">Paid hours by workweek</div>
                  {data.exempt && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-fill-strong text-fg-secondary">Exempt · no overtime</span>
                  )}
                </div>
                {data.weeks.map((w) => (
                  <div key={w.weekStart} className="flex items-center justify-between gap-2 py-1 text-[11px] tabular-nums">
                    <span className="text-fg-muted">Week of {formatDayHeader(w.weekStart)}</span>
                    <span className="text-fg-body">
                      {w.regularHours.toFixed(2)} reg
                      <span className={w.overtimeHours > 0 ? "text-warning-fg font-semibold" : "text-fg-subtle"}> · {w.overtimeHours.toFixed(2)} OT</span>
                      {w.doubleTimeHours > 0 && (
                        <span className="text-danger-fg font-semibold"> · {w.doubleTimeHours.toFixed(2)} DT</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Per-day cards */}
            {data.days.length === 0 ? (
              <div className="bg-card rounded-2xl border border-line/60 px-4 py-10 text-center">
                <div className="text-fg-muted text-sm font-medium">Nothing recorded in this period</div>
                <div className="text-fg-subtle text-xs mt-1">No shifts, punches, or call-outs for these dates</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {data.days.map((day) => (
                  <div key={day.date} className="bg-card rounded-2xl border border-line/60 px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-sm font-bold text-fg">{formatDayHeader(day.date)}</div>
                      <div className="text-[11px] text-fg-muted">
                        {(day.schedules ?? (day.schedule ? [day.schedule] : [])).length > 0
                          ? (day.schedules ?? [day.schedule!])
                              .map((s) => `${fmtMinutes(s.startMinutes)} – ${fmtMinutes(s.endMinutes)}`)
                              .join(", ")
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
                            <span className="text-[11px] text-fg-muted">{v.detail}</span>
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
                            <span className="text-fg-muted">{PUNCH_LABELS[p.punchType]}</span>
                            <span className="text-fg-body font-semibold tabular-nums">
                              {formatPunchTime(p.punchedAt, data.timezone)}
                            </span>
                            {p.roundedAt && (
                              <span className="text-fg-subtle tabular-nums" title="Rounded time payroll pays">
                                → {formatPunchTime(p.roundedAt, data.timezone)}
                              </span>
                            )}
                            {p.isManual && (
                              <PunchHistoryToggle
                                punchId={p.id}
                                timezone={data.timezone}
                                label="✎"
                                title="Manual correction"
                                className="text-[9px] text-warning-fg uppercase cursor-pointer"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      !day.callout && <div className="text-[11px] text-fg-subtle italic">No punches</div>
                    )}

                    {/* Hours footer */}
                    {(day.workedHours > 0 || day.breakHours > 0 || day.hasIncomplete) && (
                      <div className="mt-2 pt-2 border-t border-line/60 flex items-center gap-3 text-[11px] text-fg-muted">
                        <span className="font-semibold text-fg-secondary tabular-nums">{day.workedHours.toFixed(2)}h worked</span>
                        {day.roundedWorkedHours != null && day.roundedWorkedHours !== day.workedHours && (
                          <span className="tabular-nums" title="From the rounded punch times">{day.roundedWorkedHours.toFixed(2)}h rounded</span>
                        )}
                        {day.breakHours > 0 && <span className="tabular-nums">{day.breakHours.toFixed(2)}h break</span>}
                        {day.hasIncomplete && (
                          <span className="text-warning-fg" title="Missing a clock-out or break-end">⚠ incomplete</span>
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
          className="px-5 border-t border-line shrink-0"
          style={{ paddingTop: 12, paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <button
            onClick={onExport}
            className="w-full py-2.5 rounded-xl bg-fill border border-line-strong text-fg-body font-semibold text-sm cursor-pointer hover:bg-fill-strong transition-colors"
          >
            Export CSV
          </button>
        </div>
      )}
    </>
  );
}
