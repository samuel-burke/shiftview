"use client";

import { useState } from "react";
import type { PayrollPeriodInfo } from "@/lib/pay-periods-server";
import { PAY_PERIOD_STATUS_LABELS } from "@/lib/pay-periods";
import { dateKeyInTz, formatDateKey } from "@/lib/dates";

type Props = {
  info: PayrollPeriodInfo | null;
  employees: { employeeId: number; employeeName: string }[];
  timezone: string;
  // After an approve, lock or reopen: regenerate the report.
  onChanged: () => void;
  // Switch the report to one pay period's dates.
  onUseRange: (from: string, to: string) => void;
};

function fmt(key: string): string {
  return formatDateKey(key, { weekday: "short", month: "short", day: "numeric" });
}

const STATUS_CLASSES = {
  open: "bg-fill text-fg-muted",
  approved: "bg-accent/10 text-accent-fg",
  locked: "bg-success/10 text-success-fg",
} as const;

// Reports → Payroll, once a report is generated in a store with pay periods
// (migration 0062): which period the dates cover and its status, the
// approve / lock / reopen actions, a warning before exporting hours that can
// still change, and each employee's sign-off. Renders with the report, below
// the controls, so nothing above it moves.
export default function PayrollPeriodPanel({ info, employees, timezone, onChanged, onUseRange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  if (!info) return null;
  const period = info.period;

  if (!period) {
    return (
      <div className="bg-warning/10 border border-warning/25 rounded-2xl px-4 py-3 text-xs text-warning-fg-strong space-y-2" data-testid="payroll-period-panel">
        <div role="status">These dates aren&apos;t a single pay period, so they can&apos;t be approved or locked.</div>
        <div className="flex flex-wrap gap-2">
          {info.overlapping.map((p) => (
            <button
              key={p.start}
              type="button"
              onClick={() => onUseRange(p.start, p.end)}
              className="px-3 min-h-9 rounded-lg bg-card border border-line/60 text-fg-body font-semibold"
            >
              Use {fmt(p.start)} – {fmt(p.end)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  async function act(action: "approve" | "lock" | "reopen") {
    if (!period) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pay-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, date: period.start, ...(action === "reopen" ? { reason } : {}) }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(json?.error ?? "Couldn't update the pay period. Try again.");
      return;
    }
    setReopening(false);
    setReason("");
    onChanged();
  }

  const signoffs = new Map(period.signoffs.map((s) => [s.employeeId, s]));
  const signedCount = period.signoffs.filter((s) => s.status === "signed").length;

  return (
    <div className="bg-card rounded-2xl border border-line/60 px-4 py-3 space-y-3" data-testid="payroll-period-panel">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold text-fg-body">Pay period {fmt(period.start)} – {fmt(period.end)}</div>
        <span
          data-testid="payroll-period-status"
          className={`text-[10px] font-semibold px-2 py-px rounded-full ${STATUS_CLASSES[period.status]}`}
        >
          {PAY_PERIOD_STATUS_LABELS[period.status]}
        </span>
      </div>

      {period.status !== "locked" && (
        <div role="status" className="px-3 py-2.5 bg-warning/10 border border-warning/25 rounded-xl text-xs text-warning-fg-strong">
          This pay period isn&apos;t locked: its hours can still change after you export.
          {period.status === "open" ? " Approve and lock it before paying." : " Lock it before paying."}
        </div>
      )}

      {reopening ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-[11px] text-fg-muted mb-1 block">Why reopen it? (kept with the pay period)</span>
            <textarea
              aria-label="Reason for reopening"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full bg-fill border border-field rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => act("reopen")}
              className="flex-1 min-h-10 rounded-xl bg-warning/15 text-warning-fg-strong text-sm font-semibold disabled:opacity-50"
            >
              Reopen
            </button>
            <button
              type="button"
              onClick={() => { setReopening(false); setError(null); }}
              className="min-h-10 px-4 rounded-xl bg-fill text-fg-muted text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {period.status === "open" && (
            <button type="button" disabled={busy} onClick={() => act("approve")}
              className="flex-1 min-h-10 rounded-xl bg-accent-solid text-on-accent text-sm font-semibold disabled:opacity-50">
              Approve
            </button>
          )}
          {period.status === "approved" && (
            <button type="button" disabled={busy} onClick={() => act("lock")}
              className="flex-1 min-h-10 rounded-xl bg-accent-solid text-on-accent text-sm font-semibold disabled:opacity-50">
              Lock
            </button>
          )}
          {period.status !== "open" && (
            <button type="button" disabled={busy} onClick={() => setReopening(true)}
              className="min-h-10 px-4 rounded-xl bg-fill text-fg-body text-sm font-semibold disabled:opacity-50">
              Reopen
            </button>
          )}
        </div>
      )}

      {error && <div role="alert" className="text-xs text-danger-fg">{error}</div>}

      {employees.length > 0 && (
        <div>
          <div className="text-[10px] text-fg-subtle font-semibold uppercase mb-1">
            Employee sign-off · {signedCount} of {employees.length} signed
          </div>
          <ul className="divide-y divide-line/60" aria-label="Employee sign-off">
            {employees.map((e) => {
              const s = signoffs.get(e.employeeId);
              return (
                <li key={e.employeeId} className="flex items-start justify-between gap-3 py-1.5 text-xs" data-testid="payroll-signoff-row">
                  <span className="text-fg-body truncate">{e.employeeName}</span>
                  <span className={`text-right ${s?.status === "signed" ? "text-success-fg" : s?.status === "disputed" ? "text-warning-fg-strong" : "text-fg-subtle"}`}>
                    {!s ? "Not signed"
                      : s.status === "signed" ? `Signed ${formatDateKey(dateKeyInTz(s.signedAt, timezone), { month: "short", day: "numeric" })}`
                      : `Disputed: ${s.note ?? ""}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
