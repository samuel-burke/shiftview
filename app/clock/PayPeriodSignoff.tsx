"use client";

import { useEffect, useState } from "react";
import type { PayPeriodsResponse } from "@/app/api/pay-periods/route";
import type { PayPeriodSignoff as Signoff, PayPeriodView } from "@/lib/pay-periods-server";
import { PAY_PERIOD_STATUS_LABELS } from "@/lib/pay-periods";
import { dateKeyInTz, formatDateKey, formatTimeInTz } from "@/lib/dates";

type Props = {
  timezone: string;
  // Changes with the employee's punches: a punch in the period clears their
  // sign-off (migration 0062), so the card reloads with it.
  refreshKey: string;
};

function fmtDay(key: string): string {
  return formatDateKey(key, { weekday: "short", month: "short", day: "numeric" });
}

// The employee's sign-off for the latest pay period that has reached its last
// day: "I confirm these hours are correct", or a dispute with a note. Shown
// only when the store uses pay periods. It renders at the end of My Hours,
// the last thing on the clock page, so appearing after it loads moves nothing.
export default function PayPeriodSignoff({ timezone, refreshKey }: Props) {
  const [period, setPeriod] = useState<PayPeriodView | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pay-periods?signable=1")
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as PayPeriodsResponse | null;
        if (cancelled || !r.ok || !json?.enabled || !Array.isArray(json.periods)) return;
        setPeriod(json.periods[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!period) return null;
  const mine: Signoff | undefined = period.signoffs[0];

  async function submit(status: "signed" | "disputed") {
    if (!period) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pay-periods/signoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: period.start, status, note: status === "disputed" ? note : undefined }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(json?.error ?? "Couldn't save. Try again.");
      return;
    }
    setDisputing(false);
    setNote("");
    setPeriod({ ...period, signoffs: [json.signoff] });
  }

  const when = (iso: string) =>
    `${formatDateKey(dateKeyInTz(iso, timezone), { month: "short", day: "numeric" })} at ${formatTimeInTz(iso, timezone)}`;

  return (
    <div className="mt-4" data-testid="pay-period-signoff">
      <div className="text-xs font-bold text-fg-muted uppercase tracking-[0.08em] mb-2">Pay Period Sign-off</div>
      <div className="bg-card rounded-2xl border border-line/60 px-4 py-3.5 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium text-fg-body">{fmtDay(period.start)} – {fmtDay(period.end)}</div>
          <div className="text-[11px] text-fg-muted" data-testid="pay-period-status">{PAY_PERIOD_STATUS_LABELS[period.status]}</div>
        </div>

        {mine && !disputing && (
          <div
            role="status"
            data-testid="pay-period-my-signoff"
            className={`px-3 py-2.5 rounded-xl text-xs ${mine.status === "signed" ? "bg-success/10 text-success-fg" : "bg-warning/10 text-warning-fg-strong"}`}
          >
            {mine.status === "signed"
              ? <>You confirmed these hours on {when(mine.signedAt)}.</>
              : <>You disputed these hours on {when(mine.signedAt)}: &ldquo;{mine.note}&rdquo;</>}
          </div>
        )}

        {disputing ? (
          <div className="space-y-2">
            <label className="block">
              <span className="text-[11px] text-fg-muted mb-1 block">What&apos;s wrong with your hours?</span>
              <textarea
                aria-label="What's wrong with your hours?"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full bg-fill border border-field rounded-xl px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => submit("disputed")}
                disabled={busy || !note.trim()}
                className="flex-1 min-h-11 rounded-xl bg-warning/15 text-warning-fg-strong text-sm font-semibold disabled:opacity-50"
              >
                Send to my manager
              </button>
              <button
                type="button"
                onClick={() => { setDisputing(false); setError(null); }}
                className="min-h-11 px-4 rounded-xl bg-fill text-fg-muted text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {mine?.status !== "signed" && (
              <button
                type="button"
                onClick={() => submit("signed")}
                disabled={busy}
                className="flex-1 min-h-11 rounded-xl bg-accent text-on-accent text-sm font-semibold disabled:opacity-50"
              >
                I confirm these hours are correct
              </button>
            )}
            <button
              type="button"
              onClick={() => { setDisputing(true); setNote(mine?.status === "disputed" ? mine.note ?? "" : ""); }}
              disabled={busy}
              className={`${mine?.status === "signed" ? "flex-1" : ""} min-h-11 px-4 rounded-xl bg-fill text-fg-body text-sm font-semibold disabled:opacity-50`}
            >
              {mine?.status === "disputed" ? "Edit dispute" : "Something's wrong"}
            </button>
          </div>
        )}

        {error && <div role="alert" className="text-xs text-danger-fg">{error}</div>}
      </div>
    </div>
  );
}
