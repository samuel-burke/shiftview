"use client";

import { useState } from "react";
import SaveStatusText, { type SaveStatus } from "./SaveStatusText";
import SettingsSectionLabel from "./SettingsSectionLabel";
import {
  DEFAULT_WEEKLY_ANCHOR,
  payPeriodContaining,
  type PayPeriodFrequency,
  type PayPeriodSettings,
} from "@/lib/pay-periods";
import { formatDateKey } from "@/lib/dates";

const OPTIONS: { value: PayPeriodFrequency; label: string }[] = [
  { value: "none", label: "None: payroll is any date range" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "semimonthly", label: "Twice a month (1st–15th, 16th–end)" },
];

function fmt(key: string): string {
  return formatDateKey(key, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// Settings → Pay Period (manager only): how often the store runs payroll. Off
// ("none") by default. With periods on, managers approve and lock each period
// from Reports → Payroll and employees sign off their hours on the clock.
export default function PayPeriodSection({
  value,
  todayKey,
  onChange,
}: {
  value: PayPeriodSettings;
  todayKey: string;
  onChange: (next: PayPeriodSettings) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // A biweekly choice waits for its first day before it can be saved.
  const [draft, setDraft] = useState<PayPeriodSettings>(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  async function save(next: PayPeriodSettings) {
    setDraft(next);
    if (next.frequency === "biweekly" && !next.anchor) {
      setError("Pick the first day of one pay period.");
      return;
    }
    setError(null);
    setStatus("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payPeriod: { frequency: next.frequency, anchor: next.anchor } }),
    }).catch(() => null);
    if (res?.ok) {
      onChange(next);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } else {
      const json = await res?.json().catch(() => null);
      setError(json?.error ?? null);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  const current = payPeriodContaining(todayKey, draft);
  const showAnchor = draft.frequency === "weekly" || draft.frequency === "biweekly";

  return (
    <section>
      <SettingsSectionLabel label="Pay Period">
        <SaveStatusText status={status} testId="pay-period-status" />
      </SettingsSectionLabel>
      <div className="bg-card rounded-2xl border border-line/60 px-4 py-4 space-y-3">
        <select
          aria-label="Pay period"
          value={draft.frequency}
          onChange={(e) => save({ ...draft, frequency: e.target.value as PayPeriodFrequency })}
          className="w-full bg-fill border border-field rounded-xl px-3 py-2.5 text-sm text-fg cursor-pointer focus:outline-none focus:border-accent transition-colors"
        >
          {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {showAnchor && (
          <label className="block">
            <span className="text-[10px] text-fg-subtle font-semibold uppercase mb-1 block">
              First day of a pay period{draft.frequency === "weekly" ? " (default: Monday)" : ""}
            </span>
            <input
              type="date"
              aria-label="First day of a pay period"
              value={draft.anchor ?? (draft.frequency === "weekly" ? DEFAULT_WEEKLY_ANCHOR : "")}
              onChange={(e) => save({ ...draft, anchor: e.target.value || null })}
              className="w-full bg-fill border border-field rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent"
            />
          </label>
        )}
        {error && <div role="alert" className="text-xs text-danger-fg">{error}</div>}
        <div className="text-xs text-fg-muted" data-testid="pay-period-current">
          {current
            ? <>Current period: {fmt(current.start)} – {fmt(current.end)}. Approve and lock each period in Reports → Payroll; a locked period&apos;s punches can&apos;t change until a manager reopens it.</>
            : <>Payroll can be run for any dates. Turn on pay periods to approve, lock and have employees sign off their hours.</>}
        </div>
      </div>
    </section>
  );
}
