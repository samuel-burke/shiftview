"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { fmtMinutes, formatDisplayName, type Employee } from "../data/types";
import type { CoverageBlock } from "../lib/coverage";
import { dayOfWeek } from "../lib/draft-metrics";
import type { EmployeeLimitColumns, EmploymentType, OvertimePolicy, PendingTimeOffPolicy, SchedulingRules } from "../lib/scheduling-rules";
import type { Adjustment } from "../lib/scheduler/types";
import SegmentedControl from "./SegmentedControl";

// Week page (Draft mode) → Auto-schedule: check the week is ready, choose how to treat the
// existing drafts, set this run's overtime and time-off rules, add one-off
// adjustments, and generate. The page makes the request (onGenerate).

export type PlannerEmployee = Employee & EmployeeLimitColumns;

export type GenerateRequest = {
  mode: "fill" | "replace";
  rules: { overtimePolicy: OvertimePolicy; pendingTimeOff: PendingTimeOffPolicy };
  adjustments: Adjustment[];
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMES = Array.from({ length: 49 }, (_, i) => i * 30); // 12:00 AM … midnight

const selectClass =
  "bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500/70 cursor-pointer min-w-0";

type AdderKind = "coverage" | "employee_off" | "employee_hours";

export function describeAdjustment(a: Adjustment, nameOf: (id: number) => string): string {
  switch (a.kind) {
    case "coverage": {
      const people = Math.abs(a.delta) === 1 ? "person" : "people";
      return `${DAY_SHORT[dayOfWeek(a.date)]} ${fmtMinutes(a.startMinutes)}–${fmtMinutes(a.endMinutes)}: ${a.delta > 0 ? "+" : "−"}${Math.abs(a.delta)} ${people}`;
    }
    case "employee_off":
      return `${nameOf(a.employeeId)} off ${DAY_SHORT[dayOfWeek(a.date)]}`;
    case "employee_hours": {
      const parts = [];
      if (a.minHours !== null) parts.push(`at least ${a.minHours} h`);
      if (a.maxHours !== null) parts.push(`up to ${a.maxHours} h`);
      return `${nameOf(a.employeeId)}: ${parts.join(", ")}`;
    }
  }
}

function Check({ ok, children }: { ok: boolean | "warn"; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        aria-hidden="true"
        className={`mt-px size-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
          ok === true ? "bg-emerald-500/15 text-emerald-400" : ok === "warn" ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"
        }`}
      >
        {ok === true ? "✓" : "!"}
      </span>
      <div className="min-w-0 flex-1 text-slate-300">{children}</div>
    </li>
  );
}

export default function AutoScheduleSheet({
  open,
  onClose,
  weekLabel,
  dates,
  employees,
  draftCount,
  curves,
  rules,
  initialAdjustments,
  generating,
  error,
  onGenerate,
  onSetEmploymentType,
}: {
  open: boolean;
  onClose: () => void;
  weekLabel: string;
  dates: string[];
  employees: PlannerEmployee[];
  draftCount: number;
  curves: Record<string, CoverageBlock[]>;
  rules: SchedulingRules;
  initialAdjustments: Adjustment[];
  generating: boolean;
  error: string | null;
  onGenerate: (request: GenerateRequest) => void;
  onSetEmploymentType: (employeeId: number, type: EmploymentType) => Promise<void>;
}) {
  const [mode, setMode] = useState<"fill" | "replace">("fill");
  const [overtimePolicy, setOvertimePolicy] = useState<OvertimePolicy>(rules.overtimePolicy);
  const [pendingPolicy, setPendingPolicy] = useState<PendingTimeOffPolicy>(rules.pendingTimeOff);
  const [adjustments, setAdjustments] = useState<Adjustment[]>(initialAdjustments);
  const [adder, setAdder] = useState<AdderKind | null>(null);
  const [form, setForm] = useState({ date: dates[0], start: 540, end: 720, delta: 1, employeeId: 0, maxHours: "" });
  const [pending, setPending] = useState<{ employeeId: number; date: string }[] | null>(null);
  const [typeSaving, setTypeSaving] = useState<number | null>(null);
  const [showUntyped, setShowUntyped] = useState(false);

  // Start each opening from the current defaults.
  const [openedFor, setOpenedFor] = useState<boolean>(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setMode(draftCount > 0 ? "fill" : "replace");
      setOvertimePolicy(rules.overtimePolicy);
      setPendingPolicy(rules.pendingTimeOff);
      setAdjustments(initialAdjustments);
      setAdder(null);
      setForm((f) => ({ ...f, date: dates[0], employeeId: employees[0]?.id ?? 0 }));
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/time-off")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body: { requests?: { employeeId: number; date: string; status: string }[] }) => {
        if (cancelled) return;
        const week = new Set(dates);
        setPending((body.requests ?? []).filter((r) => r.status === "pending" && week.has(String(r.date).slice(0, 10))));
      })
      .catch(() => { if (!cancelled) setPending([]); });
    return () => { cancelled = true; };
  }, [open, dates]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !generating) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, generating, onClose]);

  const nameOf = useMemo(() => {
    const byId = new Map(employees.map((e) => [e.id, formatDisplayName(e.name)]));
    return (id: number) => byId.get(id) ?? "Someone";
  }, [employees]);

  const daysWithTarget = dates.filter((d) => (curves[d] ?? []).some((b) => b.headcount > 0));
  const daysWithout = dates.filter((d) => !daysWithTarget.includes(d));
  const untyped = employees.filter((e) => !e.employment_type);
  const canGenerate = !generating && employees.length > 0 && daysWithTarget.length > 0;

  function addAdjustment() {
    if (adder === "coverage") {
      if (form.end <= form.start) return;
      setAdjustments((a) => [...a, { kind: "coverage", date: form.date, startMinutes: form.start, endMinutes: form.end, delta: form.delta }]);
    } else if (adder === "employee_off") {
      setAdjustments((a) => [...a, { kind: "employee_off", employeeId: form.employeeId, date: form.date }]);
    } else if (adder === "employee_hours") {
      const max = Number(form.maxHours);
      if (form.maxHours.trim() === "" || !Number.isFinite(max) || max < 0 || max > 80 || !Number.isInteger(max * 2)) return;
      setAdjustments((a) => [
        ...a.filter((x) => !(x.kind === "employee_hours" && x.employeeId === form.employeeId)),
        { kind: "employee_hours", employeeId: form.employeeId, minHours: null, maxHours: max },
      ]);
    }
    setAdder(null);
  }

  async function setType(employeeId: number, type: EmploymentType) {
    setTypeSaving(employeeId);
    try { await onSetEmploymentType(employeeId, type); } finally { setTypeSaving(null); }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="auto-schedule-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-end justify-center tablet:items-center tablet:px-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!generating) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-schedule-title"
            data-testid="auto-schedule-sheet"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] tablet:max-w-[560px] max-h-[88dvh] flex flex-col bg-card border border-slate-700 rounded-t-3xl tablet:rounded-3xl overflow-hidden"
            style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-800">
              <div className="min-w-0">
                <h2 id="auto-schedule-title" className="text-lg font-bold text-slate-100">Auto-schedule</h2>
                <div className="text-xs text-slate-400 tabular-nums">{weekLabel}</div>
              </div>
              <button
                onClick={onClose}
                disabled={generating}
                autoFocus
                aria-label="Close"
                className="size-10 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
              {/* Readiness */}
              <section aria-labelledby="as-ready">
                <h3 id="as-ready" className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2">Before you start</h3>
                <ul className="flex flex-col gap-2">
                  <Check ok={daysWithTarget.length === 0 ? false : daysWithout.length ? "warn" : true}>
                    {daysWithTarget.length === 0 ? (
                      <>No coverage targets this week, so there&apos;s nothing to schedule. <Link href="/coverage" className="text-indigo-400 font-semibold">Set coverage</Link></>
                    ) : daysWithout.length ? (
                      <>No coverage target on {daysWithout.map((d) => DAY_SHORT[dayOfWeek(d)]).join(", ")}; nobody will be scheduled then. <Link href="/coverage" className="text-indigo-400 font-semibold">Edit coverage</Link></>
                    ) : (
                      "Coverage targets set for every day"
                    )}
                  </Check>
                  <Check ok={employees.length === 0 ? false : untyped.length ? "warn" : true}>
                    {employees.length === 0 ? (
                      "No employees to schedule"
                    ) : untyped.length === 0 ? (
                      "Everyone is set as full-time or part-time"
                    ) : (
                      <>
                        {untyped.length} {untyped.length === 1 ? "person has" : "people have"} no employment type and will be scheduled as part-time.{" "}
                        <button
                          onClick={() => setShowUntyped((v) => !v)}
                          aria-expanded={showUntyped}
                          className="text-indigo-400 font-semibold bg-transparent border-none px-0 py-1 cursor-pointer"
                        >
                          {showUntyped ? "Hide" : "Set them now"}
                        </button>
                        {showUntyped && (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {untyped.map((e) => (
                              <li key={e.id} className="flex items-center gap-2">
                                <span className="flex-1 min-w-0 truncate text-slate-200">{formatDisplayName(e.name)}</span>
                                {(["full_time", "part_time"] as const).map((t) => (
                                  <button
                                    key={t}
                                    onClick={() => setType(e.id, t)}
                                    disabled={typeSaving === e.id}
                                    className="min-h-9 text-xs font-semibold px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-slate-100 cursor-pointer disabled:opacity-50"
                                  >
                                    {t === "full_time" ? "Full-time" : "Part-time"}
                                  </button>
                                ))}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </Check>
                  <Check ok={pending === null || pending.length === 0 ? true : "warn"}>
                    {pending === null
                      ? "Checking time-off requests…"
                      : pending.length === 0
                      ? "No pending time-off requests this week"
                      : `${pending.length} pending time-off request${pending.length === 1 ? "" : "s"} this week (approved time off is always respected)`}
                  </Check>
                </ul>
              </section>

              {/* Mode */}
              {draftCount > 0 && (
                <section aria-labelledby="as-mode">
                  <h3 id="as-mode" className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2">Your {draftCount} draft{draftCount === 1 ? "" : "s"}</h3>
                  <SegmentedControl
                    ariaLabel="What to do with your drafts"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "fill", label: "Keep & fill around" },
                      { value: "replace", label: "Start fresh" },
                    ]}
                  />
                  <div className="text-[11px] text-slate-500 mt-1.5">
                    {mode === "fill" ? "Your drafts stay as they are; new shifts fill the rest." : "Your drafts are replaced. Undo brings them back."}
                  </div>
                </section>
              )}

              {/* Run rules */}
              <section aria-labelledby="as-rules" className="flex flex-col gap-3">
                <h3 id="as-rules" className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Rules for this week</h3>
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs font-semibold text-slate-300">Overtime</div>
                  <SegmentedControl
                    ariaLabel="Overtime"
                    value={overtimePolicy}
                    onChange={setOvertimePolicy}
                    options={[
                      { value: "never", label: "Never" },
                      { value: "when_needed", label: "To fill gaps" },
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs font-semibold text-slate-300">Pending time off</div>
                  <SegmentedControl
                    ariaLabel="Pending time off"
                    value={pendingPolicy}
                    onChange={setPendingPolicy}
                    options={[
                      { value: "avoid", label: "Avoid those days" },
                      { value: "ignore", label: "Ignore" },
                    ]}
                  />
                </div>
                <div className="text-[11px] text-slate-500">
                  Shifts {rules.minShiftMinutes / 60}–{rules.maxShiftMinutes / 60} h · {rules.minRestMinutes / 60} h rest · up to {rules.maxConsecutiveDays} days in a row.{" "}
                  <Link href="/settings#settings-workplace" className="text-indigo-400 font-semibold">Change in Settings</Link>
                </div>
              </section>

              {/* Adjustments */}
              <section aria-labelledby="as-adjust" className="flex flex-col gap-2">
                <h3 id="as-adjust" className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">This week only</h3>
                {adjustments.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {adjustments.map((a, i) => (
                      <li key={i} className="flex items-center gap-1 text-[11px] text-indigo-200 bg-indigo-500/15 border border-indigo-500/30 rounded-full pl-2.5 pr-1 py-1">
                        <span>{describeAdjustment(a, nameOf)}</span>
                        <button
                          onClick={() => setAdjustments((list) => list.filter((_, j) => j !== i))}
                          aria-label={`Remove ${describeAdjustment(a, nameOf)}`}
                          className="size-7 -my-1 -mr-0.5 rounded-full bg-transparent border-none text-base leading-none text-indigo-300 hover:text-indigo-100 cursor-pointer flex items-center justify-center"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ["coverage", "+ Extra people"],
                    ["employee_off", "+ Keep someone off"],
                    ["employee_hours", "+ Someone's hours"],
                  ] as [AdderKind, string][]).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => setAdder(adder === kind ? null : kind)}
                      aria-expanded={adder === kind}
                      className={`min-h-9 text-xs font-semibold px-3 rounded-lg border cursor-pointer transition-colors ${
                        adder === kind ? "bg-slate-700 border-slate-600 text-slate-100" : "bg-slate-800 border-slate-700 text-slate-300 hover:text-slate-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {adder && (
                  <div className="flex flex-wrap items-end gap-2 bg-slate-800/50 border border-slate-800 rounded-xl p-3">
                    {adder !== "coverage" && (
                      <label className="flex flex-col gap-1 text-[11px] text-slate-500 font-semibold uppercase">
                        Who
                        <select aria-label="Employee" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: Number(e.target.value) })} className={selectClass}>
                          {employees.map((e) => <option key={e.id} value={e.id}>{formatDisplayName(e.name)}</option>)}
                        </select>
                      </label>
                    )}
                    {adder !== "employee_hours" && (
                      <label className="flex flex-col gap-1 text-[11px] text-slate-500 font-semibold uppercase">
                        Day
                        <select aria-label="Day" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={selectClass}>
                          {dates.map((d) => <option key={d} value={d}>{DAY_SHORT[dayOfWeek(d)]} {Number(d.slice(8, 10))}</option>)}
                        </select>
                      </label>
                    )}
                    {adder === "coverage" && (
                      <>
                        <label className="flex flex-col gap-1 text-[11px] text-slate-500 font-semibold uppercase">
                          From
                          <select aria-label="From" value={form.start} onChange={(e) => setForm({ ...form, start: Number(e.target.value) })} className={selectClass}>
                            {TIMES.slice(0, -1).map((t) => <option key={t} value={t}>{fmtMinutes(t)}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-slate-500 font-semibold uppercase">
                          To
                          <select aria-label="To" value={form.end} onChange={(e) => setForm({ ...form, end: Number(e.target.value) })} className={selectClass}>
                            {TIMES.slice(1).map((t) => <option key={t} value={t}>{t === 1440 ? "Midnight" : fmtMinutes(t)}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-slate-500 font-semibold uppercase">
                          People
                          <select aria-label="People" value={form.delta} onChange={(e) => setForm({ ...form, delta: Number(e.target.value) })} className={selectClass}>
                            {[-3, -2, -1, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n > 0 ? `+${n}` : `−${-n}`}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                    {adder === "employee_hours" && (
                      <label className="flex flex-col gap-1 text-[11px] text-slate-500 font-semibold uppercase">
                        Up to
                        <span className="flex items-center gap-1">
                          <input
                            aria-label="Most hours this week"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={80}
                            step={0.5}
                            value={form.maxHours}
                            onChange={(e) => setForm({ ...form, maxHours: e.target.value })}
                            className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 text-right tabular-nums focus:outline-none focus:border-indigo-500/70"
                          />
                          <span className="text-xs text-slate-400 normal-case font-normal">h</span>
                        </span>
                      </label>
                    )}
                    <button
                      onClick={addAdjustment}
                      className="min-h-9 text-xs font-semibold px-4 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                )}
              </section>

              {error && <div role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</div>}
            </div>

            <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-800" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
              <button
                onClick={onClose}
                disabled={generating}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-slate-300 bg-slate-800 border border-slate-700 cursor-pointer hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => onGenerate({ mode: draftCount > 0 ? mode : "replace", rules: { overtimePolicy, pendingTimeOff: pendingPolicy }, adjustments })}
                disabled={!canGenerate}
                aria-busy={generating}
                className="flex-[2] py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-violet-500 border-none cursor-pointer hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? "Generating…" : "Generate Schedule"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
