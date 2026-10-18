"use client";

import { useEffect, useMemo, useState } from "react";
import SegmentedControl from "../../components/SegmentedControl";
import type { TimecardResponse } from "@/app/api/timecard/route";
import { DEFAULT_TIMEZONE, formatDateKey } from "@/lib/dates";
import PayPeriodSignoff from "./PayPeriodSignoff";
import { WEEKLY_OVERTIME_THRESHOLD_HOURS } from "@/lib/payroll";
import { formatHours, myHoursRange, summarizeWeek, type MyHoursFlag } from "@/lib/my-hours";

type Props = {
  employeeId: number;
  todayKey: string;
  // Changes whenever the employee's punches do, so the totals follow a punch
  // made on this screen or another device.
  refreshKey: string;
  // The store's timezone, for the sign-off's time.
  timezone?: string;
};

const FLAG_CLASSES: Record<MyHoursFlag["tone"], string> = {
  bad:  "text-danger-fg-strong bg-danger/10",
  warn: "text-warning-fg-strong bg-warning/10",
  info: "text-accent-fg bg-accent/10",
};

function fmtDay(key: string): string {
  return formatDateKey(key, { weekday: "short", month: "short", day: "numeric" });
}

// The employee's own time card for this workweek and last: worked hours split
// into regular and overtime the way payroll pays them, and each day's hours,
// breaks and flags.
export default function MyHours({ employeeId, todayKey, refreshKey, timezone = DEFAULT_TIMEZONE }: Props) {
  const range = useMemo(() => myHoursRange(todayKey), [todayKey]);
  const [data, setData] = useState<TimecardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<"this" | "last">("this");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/timecard?employeeId=${employeeId}&from=${range.from}&to=${range.to}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) {
          setError(json?.error ?? "Couldn't load your hours");
          return;
        }
        setError(null);
        setData(json as TimecardResponse);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load your hours"); });
    return () => { cancelled = true; };
  }, [employeeId, range.from, range.to, refreshKey]);

  const summary = useMemo(() => {
    if (!data) return null;
    const days = Array.isArray(data.days) ? data.days : [];
    const weeks = Array.isArray(data.weeks) ? data.weeks : [];
    return summarizeWeek(days, weeks, week === "this" ? range.thisWeekStart : range.lastWeekStart, todayKey);
  }, [data, week, range, todayKey]);

  return (
    <div data-testid="my-hours">
      <div className="text-xs font-bold text-fg-muted uppercase tracking-[0.08em] mb-2">My Hours</div>
      <div className="bg-card rounded-2xl border border-line/60">
        <div className="px-4 pt-3.5 pb-3 space-y-3">
          <SegmentedControl
            ariaLabel="Week"
            value={week}
            onChange={setWeek}
            options={[{ value: "this", label: "This week" }, { value: "last", label: "Last week" }]}
          />

          {error && !summary ? (
            <div role="status" className="text-sm text-fg-muted text-center py-2">{error}</div>
          ) : !summary ? (
            <div role="status" className="text-sm text-fg-muted text-center py-2">Loading your hours…</div>
          ) : (
            <>
              <div className="text-xs text-fg-muted text-center">
                {fmtDay(summary.weekStart)} – {fmtDay(summary.weekEnd)}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xl font-extrabold text-fg tabular-nums" data-testid="my-hours-worked">{formatHours(summary.workedHours)}</div>
                  <div className="text-[11px] text-fg-muted">Worked</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-fg-body tabular-nums" data-testid="my-hours-regular">{formatHours(summary.regularHours)}</div>
                  <div className="text-[11px] text-fg-muted">Regular</div>
                </div>
                <div>
                  <div
                    className={`text-xl font-bold tabular-nums ${summary.overtimeHours > 0 ? "text-warning-fg-strong" : "text-fg-body"}`}
                    data-testid="my-hours-overtime"
                  >
                    {formatHours(summary.overtimeHours)}
                  </div>
                  <div className="text-[11px] text-fg-muted">Overtime</div>
                </div>
              </div>
              {summary.breakHours > 0 && (
                <div className="text-xs text-fg-subtle text-center">{formatHours(summary.breakHours)} on break</div>
              )}

              {week === "this" && summary.approachingOvertime && (
                <div role="status" className="px-3 py-2.5 bg-warning/10 border border-warning/25 rounded-xl text-xs text-warning-fg-strong">
                  {formatHours(summary.hoursToOvertime)} until overtime — hours past {WEEKLY_OVERTIME_THRESHOLD_HOURS} this week are overtime.
                </div>
              )}
              {week === "this" && summary.overtimeHours > 0 && (
                <div role="status" className="px-3 py-2.5 bg-warning/10 border border-warning/25 rounded-xl text-xs text-warning-fg-strong">
                  You&apos;re in overtime this week.
                </div>
              )}
              {week === "this" && summary.shiftInProgress && (
                <div className="text-[11px] text-fg-subtle text-center">Your current shift is added when you clock out.</div>
              )}
            </>
          )}
        </div>

        {summary && (
          summary.days.length === 0 ? (
            <div className="px-4 py-3 border-t border-line text-sm text-fg-muted text-center">
              No hours recorded {week === "this" ? "this" : "last"} week.
            </div>
          ) : (
            <ul className="border-t border-line divide-y divide-line" aria-label="Days">
              {summary.days.map((d) => (
                <li key={d.date} className="flex items-start justify-between gap-3 px-4 py-3" data-testid="my-hours-day">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg-body">{fmtDay(d.date)}</div>
                    {d.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.flags.map((f) => (
                          <span key={f.label} className={`text-[10px] font-semibold px-2 py-px rounded-full ${FLAG_CLASSES[f.tone]}`}>
                            {f.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm text-fg-secondary tabular-nums">{formatHours(d.workedHours)}</div>
                    {d.breakHours > 0 && (
                      <div className="text-[11px] text-fg-subtle tabular-nums mt-0.5">{formatHours(d.breakHours)} break</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      <PayPeriodSignoff timezone={timezone} refreshKey={refreshKey} />
    </div>
  );
}
