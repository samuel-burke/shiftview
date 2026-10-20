// Pay periods: the store's payroll cycle, as calendar dates in store time.
//
// Settings (app_settings):
//   pay_period_frequency  "none" (default: payroll is any date range, as
//                         before) | "weekly" | "biweekly" | "semimonthly"
//   pay_period_anchor     YYYY-MM-DD, the first day of any one period.
//                         Biweekly needs it; weekly defaults to Mondays (the
//                         payroll workweek, lib/payroll.ts); semimonthly is
//                         always the 1st-15th and the 16th-end of month.
//
// The database computes the same periods (pay_period_bounds, migration 0062)
// when a period is approved, locked or signed, and refuses punch changes in a
// locked one. This module is the app's copy of that math: keep them in step.
// Date keys carry no time of day, so the math is immune to DST; turning an
// instant into a period goes through the store's timezone.

import { addDaysToKey, dateKeyInTz, daysBetweenKeys, isDateKey } from "@/lib/dates";

export const PAY_PERIOD_FREQUENCIES = ["none", "weekly", "biweekly", "semimonthly"] as const;
export type PayPeriodFrequency = (typeof PAY_PERIOD_FREQUENCIES)[number];

export type PayPeriodSettings = { frequency: PayPeriodFrequency; anchor: string | null };

export type PayPeriodRange = { start: string; end: string };

export type PayPeriodStatus = "open" | "approved" | "locked";

// A Monday, so weekly periods line up with the payroll workweek by default.
export const DEFAULT_WEEKLY_ANCHOR = "2024-01-01";

export const PAY_PERIOD_STATUS_LABELS: Record<PayPeriodStatus, string> = {
  open: "Open",
  approved: "Approved",
  locked: "Locked",
};

export function isPayPeriodFrequency(v: unknown): v is PayPeriodFrequency {
  return typeof v === "string" && (PAY_PERIOD_FREQUENCIES as readonly string[]).includes(v);
}

export function parsePayPeriodSettings(map: Record<string, string | undefined>): PayPeriodSettings {
  const raw = (map.pay_period_frequency ?? "").trim().toLowerCase();
  const frequency = isPayPeriodFrequency(raw) ? raw : "none";
  const anchorRaw = (map.pay_period_anchor ?? "").trim();
  return { frequency, anchor: isDateKey(anchorRaw) ? anchorRaw : null };
}

// Whether the store has pay periods at all ("none", or biweekly with no
// anchor yet, have none).
export function payPeriodsEnabled(s: PayPeriodSettings): boolean {
  return s.frequency === "semimonthly" || s.frequency === "weekly" || (s.frequency === "biweekly" && s.anchor !== null);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// The period containing `dateKey`, or null when the store has no periods.
export function payPeriodContaining(dateKey: string, s: PayPeriodSettings): PayPeriodRange | null {
  if (!isDateKey(dateKey)) return null;
  if (s.frequency === "semimonthly") {
    const [y, m, d] = dateKey.split("-").map(Number);
    const ym = `${y}-${pad2(m)}`;
    return d <= 15
      ? { start: `${ym}-01`, end: `${ym}-15` }
      : { start: `${ym}-16`, end: `${ym}-${pad2(lastDayOfMonth(y, m))}` };
  }
  let anchor: string;
  let length: number;
  if (s.frequency === "weekly") {
    anchor = s.anchor ?? DEFAULT_WEEKLY_ANCHOR;
    length = 7;
  } else if (s.frequency === "biweekly" && s.anchor) {
    anchor = s.anchor;
    length = 14;
  } else {
    return null;
  }
  const offset = ((daysBetweenKeys(anchor, dateKey) % length) + length) % length;
  const start = addDaysToKey(dateKey, -offset);
  return { start, end: addDaysToKey(start, length - 1) };
}

export function previousPayPeriod(p: PayPeriodRange, s: PayPeriodSettings): PayPeriodRange | null {
  return payPeriodContaining(addDaysToKey(p.start, -1), s);
}

export function nextPayPeriod(p: PayPeriodRange, s: PayPeriodSettings): PayPeriodRange | null {
  return payPeriodContaining(addDaysToKey(p.end, 1), s);
}

// The period an instant (a punch) falls in, by the store's calendar.
export function payPeriodForInstant(
  instant: Date | string | number,
  tz: string,
  s: PayPeriodSettings,
): PayPeriodRange | null {
  return payPeriodContaining(dateKeyInTz(instant, tz), s);
}

// Every period touching [from, to], in order.
export function payPeriodsOverlapping(from: string, to: string, s: PayPeriodSettings): PayPeriodRange[] {
  const out: PayPeriodRange[] = [];
  if (!isDateKey(from) || !isDateKey(to) || from > to) return out;
  let p = payPeriodContaining(from, s);
  while (p && p.start <= to && out.length < 400) {
    out.push(p);
    p = nextPayPeriod(p, s);
  }
  return out;
}

// [from, to] is exactly one pay period.
export function isWholePayPeriod(from: string, to: string, s: PayPeriodSettings): boolean {
  const p = payPeriodContaining(from, s);
  return p !== null && p.start === from && p.end === to;
}

// The latest period an employee can sign off: the one ending today, else the
// one before today's. Signing opens on a period's last day (pay_period_sign).
export function latestSignablePayPeriod(todayKey: string, s: PayPeriodSettings): PayPeriodRange | null {
  const current = payPeriodContaining(todayKey, s);
  if (!current) return null;
  return current.end <= todayKey ? current : previousPayPeriod(current, s);
}

// The last period that has fully ended before today: the default payroll range.
export function lastEndedPayPeriod(todayKey: string, s: PayPeriodSettings): PayPeriodRange | null {
  const current = payPeriodContaining(todayKey, s);
  return current ? previousPayPeriod(current, s) : null;
}

// Validates a settings patch ({ frequency?, anchor? }) against the stored
// settings and returns the app_settings rows to write.
export function payPeriodSettingsRows(
  patch: unknown,
  current: PayPeriodSettings,
): { rows: { key: string; value: string }[]; error: null } | { rows: null; error: string } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch))
    return { rows: null, error: "payPeriod must be an object" };
  const p = patch as Record<string, unknown>;
  const rows: { key: string; value: string }[] = [];
  let frequency = current.frequency;
  let anchor = current.anchor;
  if (p.frequency !== undefined) {
    if (!isPayPeriodFrequency(p.frequency))
      return { rows: null, error: `payPeriod.frequency must be one of: ${PAY_PERIOD_FREQUENCIES.join(", ")}` };
    frequency = p.frequency;
    rows.push({ key: "pay_period_frequency", value: frequency });
  }
  if (p.anchor !== undefined) {
    if (p.anchor !== null && !isDateKey(p.anchor))
      return { rows: null, error: "payPeriod.anchor must be a YYYY-MM-DD date or null" };
    anchor = p.anchor;
    rows.push({ key: "pay_period_anchor", value: anchor ?? "" });
  }
  if (rows.length === 0) return { rows: null, error: "payPeriod has no fields to change" };
  if (frequency === "biweekly" && !anchor)
    return { rows: null, error: "Biweekly pay periods need payPeriod.anchor, the first day of one period" };
  return { rows, error: null };
}
