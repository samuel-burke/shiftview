"use client";

import { useEffect, useState } from "react";
import CalendarExportButton from "./CalendarExportButton";

// Settings → Calendar: subscribe to your shifts in Google/Apple/Outlook with a
// private link that keeps up with schedule changes, or download a one-time
// .ics file. The link is shown once when it's made (only its hash is kept);
// making a new one turns the old one off.

const FEED_API = "/api/my-schedule/calendar/feed";

export default function CalendarSyncSection() {
  const [active, setActive] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(FEED_API)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setActive(data ? !!data.active : false); })
      .catch(() => { if (!cancelled) setActive(false); });
    return () => { cancelled = true; };
  }, []);

  async function createLink() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(FEED_API, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't make a calendar link.");
      setUrl(body.url);
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a calendar link.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(FEED_API, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't turn the calendar link off.");
      setUrl(null);
      setActive(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn the calendar link off.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const webcal = url ? url.replace(/^https?:/, "webcal:") : null;

  return (
    <section data-testid="calendar-sync">
      <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase mb-2 px-1">Calendar</div>
      <div className="bg-card rounded-2xl border border-line/60 px-4 py-4 flex flex-col gap-3">
        <div>
          <div className="text-sm font-semibold text-fg-body">Shifts in your calendar</div>
          <div className="text-xs text-fg-subtle mt-0.5">
            Subscribe once and your phone calendar follows schedule changes. Keep the link private: anyone with it can see your shifts.
          </div>
        </div>

        {url && webcal && (
          <div className="flex flex-col gap-2" data-testid="calendar-feed-link">
            <input
              readOnly
              aria-label="Your calendar link"
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full bg-fill border border-field rounded-lg px-3 py-2 text-xs text-fg font-mono"
            />
            <div className="flex gap-2">
              <a
                href={webcal}
                className="flex-1 text-center py-2.5 rounded-xl bg-info-solid text-on-accent font-bold text-sm no-underline hover:bg-info-solid-hover transition-colors"
              >
                Open in calendar app
              </a>
              <button
                type="button"
                onClick={copy}
                className="flex-1 py-2.5 rounded-xl bg-fill border border-line-strong text-fg-secondary font-semibold text-sm cursor-pointer hover:bg-fill-strong transition-colors"
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
            <div className="text-xs text-fg-subtle">Google Calendar: Other calendars → From URL, then paste the link.</div>
          </div>
        )}

        {!url && active && (
          <div className="text-xs text-success-fg">Your calendar link is on. Make a new one if you lost it (the old one stops working).</div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={createLink}
            disabled={busy || active === null}
            aria-busy={busy}
            className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-brand-from to-brand-to text-on-accent font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {active ? "Make a new link" : "Get calendar link"}
          </button>
          {active && (
            <button
              type="button"
              onClick={turnOff}
              disabled={busy}
              className="py-2.5 px-4 rounded-xl bg-transparent border border-line-strong text-danger-fg font-semibold text-sm cursor-pointer disabled:opacity-50 hover:bg-danger/10 transition-colors"
            >
              Turn off link
            </button>
          )}
          <CalendarExportButton />
        </div>
        {error && <div role="alert" className="text-xs text-danger-fg">{error}</div>}
      </div>
    </section>
  );
}
