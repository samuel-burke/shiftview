"use client";

import { useEffect, useRef, useState } from "react";
import SaveStatusText, { type SaveStatus } from "./SaveStatusText";

// Manager-only, under each employee in Settings → Team: the employee's payroll
// ID (for payroll exports) and their pay-rate history (migration 0061). A raise
// is a new rate from a date; earlier days keep the rate they had, so past
// labor cost and payroll aren't restated. A position rate pays shifts in that
// position differently from the base rate.
//
// The collapsed line uses what the roster already has (no loading); the
// history loads when the row is opened.

type Rate = { id: number; positionId: number | null; effectiveFrom: string; hourlyRate: number | null };
type Position = { id: number; name: string };

export function fmtRate(rate: number | null | undefined): string {
  return rate == null ? "No rate" : `$${rate.toFixed(2)}/h`;
}

export function fmtEffective(date: string, beginning: string): string {
  if (date <= beginning) return "Since the start";
  return `From ${new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

// "18.5" → 18.5; blank → null (no rate); anything else → "invalid".
export function parseRate(text: string): number | null | "invalid" {
  const t = text.trim().replace(/^\$/, "");
  if (t === "") return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return "invalid";
  return Number(t);
}

export default function EmployeePayRow({
  employee,
  onSaved,
}: {
  employee: { id: number; name: string; pay_rate?: number | null; payroll_id?: string | null };
  onSaved: (fields: { pay_rate?: number | null; payroll_id?: string | null }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [today, setToday] = useState<string>("");
  const [beginning, setBeginning] = useState("1900-01-01");
  const [loadError, setLoadError] = useState(false);

  const [payrollId, setPayrollId] = useState(employee.payroll_id ?? "");
  const [idStatus, setIdStatus] = useState<SaveStatus>("idle");

  const [rateText, setRateText] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [positionId, setPositionId] = useState("");
  const [rateStatus, setRateStatus] = useState<SaveStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function flash(set: (s: SaveStatus) => void, s: SaveStatus) {
    set(s);
    if (s === "saved" || s === "error") timers.current.push(setTimeout(() => set("idle"), s === "saved" ? 2000 : 4000));
  }

  async function load() {
    setLoadError(false);
    const [r, p] = await Promise.all([
      fetch(`/api/employees/${employee.id}/pay-rates`).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch("/api/positions").then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    if (!r || !Array.isArray(r.rates)) { setLoadError(true); setRates([]); return; }
    setRates(r.rates);
    setToday(r.today ?? "");
    setBeginning(r.beginning ?? "1900-01-01");
    setFromDate((d) => d || r.today || "");
    setPositions(Array.isArray(p?.positions) ? p.positions : []);
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && rates === null) void load();
  }

  // The base rate in effect today, from the history once it's loaded.
  const currentBase = rates
    ? rates.find((r) => r.positionId == null && (!today || r.effectiveFrom <= today))?.hourlyRate ?? null
    : employee.pay_rate ?? null;

  async function savePayrollId() {
    flash(setIdStatus, "saving");
    const value = payrollId.trim() || null;
    const res = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: employee.id, payrollId: value }),
    }).catch(() => null);
    if (res?.ok) { onSaved({ payroll_id: value }); flash(setIdStatus, "saved"); }
    else flash(setIdStatus, "error");
  }

  async function addRate() {
    const rate = parseRate(rateText);
    if (rate === "invalid") { setProblem("Enter a rate like 18.50."); return; }
    if (rate === null && positionId) { setProblem("A position rate needs an amount."); return; }
    if (!fromDate) { setProblem("Choose the date the rate starts."); return; }
    setProblem(null);
    flash(setRateStatus, "saving");
    const res = await fetch(`/api/employees/${employee.id}/pay-rates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hourlyRate: rate, effectiveFrom: fromDate, positionId: positionId ? Number(positionId) : null }),
    }).catch(() => null);
    if (res?.ok) {
      setRateText("");
      flash(setRateStatus, "saved");
      await load();
      if (!positionId && fromDate <= today) onSaved({ pay_rate: rate });
    } else {
      const body = await res?.json().catch(() => null);
      setProblem(typeof body?.error === "string" ? body.error : null);
      flash(setRateStatus, "error");
    }
  }

  async function removeRate(r: Rate) {
    const res = await fetch(`/api/employees/${employee.id}/pay-rates?rateId=${r.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) await load();
    else setProblem("Couldn't remove that rate.");
  }

  const positionName = (id: number | null) => (id == null ? null : positions.find((p) => p.id === id)?.name ?? "Position");
  const inputClass =
    "min-w-0 bg-fill border border-field rounded-lg px-2 py-1.5 text-xs text-fg tabular-nums placeholder:text-fg-subtle focus:outline-none focus:border-accent";

  return (
    <div data-testid={`employee-pay-${employee.id}`} className="px-4 pb-3 pt-0">
      <button
        onClick={toggle}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg-muted cursor-pointer bg-transparent border-none transition-colors py-2 -my-2 text-left"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>Pay{" "}<span className="sr-only">for {employee.name},</span></span>
        <span aria-hidden="true">·</span>
        <span className={currentBase == null ? "text-warning-fg" : "text-fg-muted"}>
          {fmtRate(currentBase)}
          {employee.payroll_id ? ` · ID ${employee.payroll_id}` : ""}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 pl-1 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor={`payroll-id-${employee.id}`} className="text-xs font-semibold text-fg-secondary">Payroll ID</label>
            <div className="w-56 shrink-0 flex items-center gap-2">
              <input
                id={`payroll-id-${employee.id}`}
                value={payrollId}
                maxLength={40}
                placeholder="Gusto ID, ADP file #…"
                onChange={(e) => setPayrollId(e.target.value)}
                className={`${inputClass} w-0 flex-1`}
              />
              <button
                type="button"
                onClick={savePayrollId}
                disabled={idStatus === "saving"}
                className="shrink-0 h-8 text-xs font-semibold px-3 rounded-lg bg-accent/20 text-accent-fg-strong border border-accent/30 hover:bg-accent/30 cursor-pointer transition-colors disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
          <SaveStatusText status={idStatus} testId={`employee-payroll-id-status-${employee.id}`} />

          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-fg-secondary">Pay rates</div>
            {rates === null ? (
              <div role="status" className="text-xs text-fg-subtle min-h-8">Loading rates…</div>
            ) : loadError ? (
              <div role="alert" className="text-xs text-danger-fg">Couldn&apos;t load pay rates.</div>
            ) : rates.length === 0 ? (
              <div className="text-xs text-fg-subtle">No rate set. Labor cost shows this employee as missing a rate.</div>
            ) : (
              <ul className="flex flex-col gap-1" aria-label={`Pay rates for ${employee.name}`}>
                {rates.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-fg-body tabular-nums">
                      {fmtRate(r.hourlyRate)}
                      {r.positionId != null && <span className="text-fg-muted"> · {positionName(r.positionId)}</span>}
                    </span>
                    <span className="flex items-center gap-2 text-fg-subtle">
                      {fmtEffective(r.effectiveFrom, beginning)}
                      <button
                        type="button"
                        onClick={() => removeRate(r)}
                        aria-label={`Remove ${fmtRate(r.hourlyRate)} ${fmtEffective(r.effectiveFrom, beginning).toLowerCase()}`}
                        className="text-danger-fg hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-fg-secondary">New rate</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                aria-label={`New hourly rate for ${employee.name}`}
                inputMode="decimal"
                placeholder="$ per hour"
                value={rateText}
                onChange={(e) => setRateText(e.target.value)}
                className={inputClass}
              />
              <input
                type="date"
                aria-label="Starts on"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={inputClass}
              />
              <select
                aria-label="Position"
                value={positionId}
                onChange={(e) => setPositionId(e.target.value)}
                className={`${inputClass} col-span-2 cursor-pointer`}
              >
                <option value="">Base rate (every position)</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} only</option>
                ))}
              </select>
            </div>
            <div className="text-[11px] text-fg-subtle">
              Hours worked from this date (store time) are paid at the new rate; earlier hours keep theirs.
            </div>
            <div className="flex items-center gap-3 min-h-10">
              <div className="flex-1 min-w-0">
                {problem && <div role="alert" className="text-xs leading-4 text-danger-fg">{problem}</div>}
                <SaveStatusText status={rateStatus} testId={`employee-pay-status-${employee.id}`} />
              </div>
              <button
                type="button"
                onClick={addRate}
                disabled={rateStatus === "saving" || rates === null}
                className="shrink-0 h-10 text-xs font-semibold px-4 rounded-lg bg-accent/20 text-accent-fg-strong border border-accent/30 hover:bg-accent/30 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add Rate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
