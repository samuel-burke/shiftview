// Paid time off: request types, accrual policies and the accrual math.
//
// Everything here is pure. Balances themselves live in the database
// (pto_ledger / pto_balances, migration 0064): approving, cancelling and
// adjusting are enforced there, so they can't drift. What the app computes
// is how many hours each accrual period should have earned, from the hours
// payroll counts as worked (computePayroll); post_pto_accruals reconciles
// the ledger to those totals and applies the carryover cap at each year end.

import { addDaysToKey, daysBetweenKeys, shiftElapsedMinutes, weekStartForKey } from "@/lib/dates";
import { WORKWEEK_START_DAY } from "@/lib/payroll";

export type LeaveType = "pto" | "sick";
export type RequestLeaveType = "unpaid" | LeaveType;

export const LEAVE_TYPES: readonly LeaveType[] = ["pto", "sick"];
export const REQUEST_LEAVE_TYPES: readonly RequestLeaveType[] = ["unpaid", "pto", "sick"];

export const LEAVE_LABELS: Record<RequestLeaveType, string> = {
  unpaid: "Unpaid",
  pto: "PTO",
  sick: "Sick",
};

export function isLeaveType(v: unknown): v is LeaveType {
  return v === "pto" || v === "sick";
}

export function isRequestLeaveType(v: unknown): v is RequestLeaveType {
  return v === "unpaid" || isLeaveType(v);
}

// A paid day with no schedule to go by is a standard day.
export const DEFAULT_PAID_HOURS = 8;
export const MAX_PAID_HOURS = 24;

// Hours as stored: numeric(…, 2).
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isValidPaidHours(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_PAID_HOURS && round2(v) === v;
}

// The hours a paid day off is worth by default: the employee's scheduled
// hours that day (real elapsed time, so a shift over a DST change counts the
// hour it gains or loses), else a standard day.
export function defaultPaidHours(
  schedules: { startMinutes: number; endMinutes: number }[],
  date: string,
  tz: string,
): number {
  const minutes = schedules.reduce(
    (sum, s) => sum + Math.max(0, shiftElapsedMinutes(date, s.startMinutes, s.endMinutes, tz)),
    0,
  );
  if (minutes <= 0) return DEFAULT_PAID_HOURS;
  return Math.min(MAX_PAID_HOURS, round2(minutes / 60));
}

// ── Policies ────────────────────────────────────────────────────────────────

export type AccrualMethod = "none" | "per_hours_worked" | "per_period";
export type AccrualPeriod = "week" | "biweekly" | "semimonthly" | "month";

export const ACCRUAL_METHODS: readonly AccrualMethod[] = ["none", "per_hours_worked", "per_period"];
export const ACCRUAL_PERIODS: readonly AccrualPeriod[] = ["week", "biweekly", "semimonthly", "month"];

export type AccrualPolicy = {
  method: AccrualMethod;
  // per_hours_worked: `hoursEarned` for every `perHoursWorked` hours worked
  // (1 per 30 is the common sick-leave rule). per_period: `hoursEarned` each
  // `period`.
  hoursEarned: number;
  perHoursWorked: number;
  period: AccrualPeriod;
  // Most hours that accrue in one calendar year.
  annualCap: number | null;
  // Most hours a balance carries into a new year; the rest is forfeited on
  // December 31.
  carryoverCap: number | null;
  // The first day that accrues. Set when the policy is turned on or its rate
  // changes, so a change never rewrites what was already earned.
  startsOn: string | null;
};

export const DEFAULT_POLICY: AccrualPolicy = {
  method: "none",
  hoursEarned: 1,
  perHoursWorked: 30,
  period: "month",
  annualCap: null,
  carryoverCap: null,
  startsOn: null,
};

export const POLICY_SETTING_KEYS: Record<LeaveType, string> = {
  pto: "pto_policy_pto",
  sick: "pto_policy_sick",
};

export type PtoPolicies = Record<LeaveType, AccrualPolicy>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_POLICY_HOURS = 10_000;

function hoursOrNull(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_POLICY_HOURS) return undefined;
  return round2(v);
}

// A stored policy (app_settings JSON); anything unreadable is "none".
export function parsePolicy(raw: string | null | undefined): AccrualPolicy {
  if (!raw) return { ...DEFAULT_POLICY };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { ...DEFAULT_POLICY }; }
  const { policy } = validatePolicy(v, DEFAULT_POLICY);
  return policy ?? { ...DEFAULT_POLICY };
}

export function parsePolicies(map: Record<string, string | undefined>): PtoPolicies {
  return {
    pto: parsePolicy(map[POLICY_SETTING_KEYS.pto]),
    sick: parsePolicy(map[POLICY_SETTING_KEYS.sick]),
  };
}

// Applies a patch to `current`, checking every field. A change to how hours
// accrue (method, rate or period) restarts accrual on `todayKey` so the past
// keeps what it earned under the old rule.
export function validatePolicy(
  patch: unknown,
  current: AccrualPolicy,
  todayKey?: string,
): { policy: AccrualPolicy; error: null } | { policy: null; error: string } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch))
    return { policy: null, error: "policy must be an object" };
  const p = patch as Record<string, unknown>;
  const next: AccrualPolicy = { ...current };

  if (p.method !== undefined) {
    if (!ACCRUAL_METHODS.includes(p.method as AccrualMethod))
      return { policy: null, error: "method must be none, per_hours_worked or per_period" };
    next.method = p.method as AccrualMethod;
  }
  if (p.hoursEarned !== undefined) {
    const v = hoursOrNull(p.hoursEarned);
    if (v === undefined || v === null || v <= 0) return { policy: null, error: "hoursEarned must be a positive number" };
    next.hoursEarned = v;
  }
  if (p.perHoursWorked !== undefined) {
    const v = hoursOrNull(p.perHoursWorked);
    if (v === undefined || v === null || v <= 0) return { policy: null, error: "perHoursWorked must be a positive number" };
    next.perHoursWorked = v;
  }
  if (p.period !== undefined) {
    if (!ACCRUAL_PERIODS.includes(p.period as AccrualPeriod))
      return { policy: null, error: "period must be week, biweekly, semimonthly or month" };
    next.period = p.period as AccrualPeriod;
  }
  for (const key of ["annualCap", "carryoverCap"] as const) {
    if (p[key] !== undefined) {
      const v = hoursOrNull(p[key]);
      if (v === undefined) return { policy: null, error: `${key} must be a non-negative number or null` };
      next[key] = v;
    }
  }
  if (p.startsOn !== undefined) {
    if (p.startsOn !== null && (typeof p.startsOn !== "string" || !DATE_RE.test(p.startsOn)))
      return { policy: null, error: "startsOn must be YYYY-MM-DD or null" };
    next.startsOn = p.startsOn as string | null;
  }

  if (todayKey) {
    const rateChanged =
      next.method !== current.method ||
      (next.method === "per_hours_worked" &&
        (next.hoursEarned !== current.hoursEarned || next.perHoursWorked !== current.perHoursWorked)) ||
      (next.method === "per_period" &&
        (next.hoursEarned !== current.hoursEarned || next.period !== current.period));
    if (next.method === "none") next.startsOn = null;
    else if (p.startsOn === undefined && (rateChanged || !next.startsOn)) next.startsOn = todayKey;
  }
  return { policy: next, error: null };
}

export function policyEnabled(policy: AccrualPolicy): boolean {
  return policy.method !== "none" && !!policy.startsOn;
}

// "1 h per 30 h worked", "8 h per month" — for the settings and the employee.
export function describePolicy(policy: AccrualPolicy): string {
  if (policy.method === "none") return "No accrual";
  const per = policy.method === "per_hours_worked"
    ? `${policy.hoursEarned} h per ${policy.perHoursWorked} h worked`
    : `${policy.hoursEarned} h per ${PERIOD_LABELS[policy.period]}`;
  const caps = [
    policy.annualCap !== null ? `up to ${policy.annualCap} h a year` : null,
    policy.carryoverCap !== null ? `${policy.carryoverCap} h carry over` : null,
  ].filter(Boolean);
  return caps.length ? `${per}, ${caps.join(", ")}` : per;
}

const PERIOD_LABELS: Record<AccrualPeriod, string> = {
  week: "week",
  biweekly: "two weeks",
  semimonthly: "half month",
  month: "month",
};

// ── Accrual periods ─────────────────────────────────────────────────────────

export type AccrualWindow = { windowStart: string; through: string };

// What a run recomputes: from the policy's start, or January 1 of last year
// if that's later (so a year-end carryover can still be corrected), through
// yesterday, the last whole day. Null when nothing has closed yet.
export function accrualWindow(policy: AccrualPolicy, todayKey: string): AccrualWindow | null {
  if (!policyEnabled(policy)) return null;
  const through = addDaysToKey(todayKey, -1);
  const lastYearStart = `${Number(through.slice(0, 4)) - 1}-01-01`;
  const windowStart = policy.startsOn! > lastYearStart ? policy.startsOn! : lastYearStart;
  return windowStart > through ? null : { windowStart, through };
}

export type AccrualPeriodRange = { start: string; end: string };

function yearEnd(key: string): string {
  return `${key.slice(0, 4)}-12-31`;
}

function monthEnd(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

// The end of the fixed period containing `key`.
function fixedPeriodEnd(key: string, period: AccrualPeriod, anchor: string): string {
  switch (period) {
    case "week":
      return addDaysToKey(weekStartForKey(key, WORKWEEK_START_DAY), 6);
    case "biweekly": {
      const offset = ((daysBetweenKeys(anchor, key) % 14) + 14) % 14;
      return addDaysToKey(key, 13 - offset);
    }
    case "semimonthly":
      return Number(key.slice(8, 10)) <= 15 ? `${key.slice(0, 7)}-15` : monthEnd(key);
    case "month":
      return monthEnd(key);
  }
}

// The periods a policy accrues over, ending in [windowStart, through]. Hours
// worked accrue per payroll workweek, split at each January 1 so every hour
// lands in the year it was worked; the first period starts on the policy's
// first day. Fixed amounts accrue per whole period that starts on or after
// the policy's first day, dated the period's last day.
export function accrualPeriods(policy: AccrualPolicy, window: AccrualWindow): AccrualPeriodRange[] {
  const startsOn = policy.startsOn ?? window.windowStart;
  const periods: AccrualPeriodRange[] = [];

  if (policy.method === "per_hours_worked") {
    let start = window.windowStart > startsOn ? window.windowStart : startsOn;
    while (start <= window.through) {
      const weekEnd = addDaysToKey(weekStartForKey(start, WORKWEEK_START_DAY), 6);
      const end = weekEnd < yearEnd(start) ? weekEnd : yearEnd(start);
      if (end > window.through) break; // not over yet
      periods.push({ start, end });
      start = addDaysToKey(end, 1);
    }
    return periods;
  }

  if (policy.method === "per_period") {
    // Biweekly periods count from the workweek the policy started in.
    const anchor = weekStartForKey(startsOn, WORKWEEK_START_DAY);
    // The first whole period: the one starting on the policy's first day, or
    // the next one.
    let start = startsOn;
    const firstEnd = fixedPeriodEnd(start, policy.period, anchor);
    const firstStart = periodStartFor(firstEnd, policy.period);
    if (firstStart < startsOn) start = addDaysToKey(firstEnd, 1);
    while (true) {
      const end = fixedPeriodEnd(start, policy.period, anchor);
      if (end > window.through) break;
      if (end >= window.windowStart) periods.push({ start, end });
      start = addDaysToKey(end, 1);
    }
  }
  return periods;
}

function periodStartFor(end: string, period: AccrualPeriod): string {
  switch (period) {
    case "week":
      return addDaysToKey(end, -6);
    case "biweekly":
      return addDaysToKey(end, -13);
    case "semimonthly":
      return end.slice(8, 10) === "15" ? `${end.slice(0, 7)}-01` : `${end.slice(0, 7)}-16`;
    case "month":
      return `${end.slice(0, 7)}-01`;
  }
}

// ── Accrual entries ─────────────────────────────────────────────────────────

export type AccrualEmployee = {
  id: number;
  // First and last day employed (hire date, archive date); null when unknown
  // or still employed.
  startDate: string | null;
  endDate: string | null;
};

export type AccrualEntry = {
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  // The total this period should have earned; post_pto_accruals posts the
  // difference from what's already in the ledger.
  hours: number;
  workedHours: number | null;
};

// Hundredths of an hour, so sums are exact.
function cents(h: number): number {
  return Math.round(h * 100);
}

// Every period's expected accrual for every employee. `workedByDay` is each
// employee's worked hours per store day, as payroll counts them (PTO hours
// are not worked hours and earn nothing).
//
// Hours-worked accrual is proportional and cumulative within the year: the
// year's hours so far times the rate, rounded down to the hundredth once,
// minus what earlier periods earned. Rounding never drifts and never
// over-credits: 30 h at 1 per 30 earns exactly 1 h, 29.99 h earns 0.99 h,
// and the remainder still counts toward the next period. The annual cap
// stops accrual for the rest of the calendar year once reached.
export function computeAccrualEntries(input: {
  policy: AccrualPolicy;
  window: AccrualWindow;
  employees: AccrualEmployee[];
  workedByDay: Record<number, Record<string, number>>;
}): AccrualEntry[] {
  const { policy, window, employees, workedByDay } = input;
  if (!policyEnabled(policy)) return [];
  const periods = accrualPeriods(policy, window);
  const capCents = policy.annualCap === null ? null : cents(policy.annualCap);
  const entries: AccrualEntry[] = [];

  for (const emp of employees) {
    const days = workedByDay[emp.id] ?? {};
    let year = "";
    let yearWorkedCents = 0;
    let yearAccruedCents = 0;

    for (const period of periods) {
      const periodYear = period.end.slice(0, 4);
      if (periodYear !== year) {
        year = periodYear;
        yearWorkedCents = 0;
        yearAccruedCents = 0;
      }

      if (policy.method === "per_hours_worked") {
        let workedCents = 0;
        for (const [date, h] of Object.entries(days)) {
          if (date >= period.start && date <= period.end) workedCents += cents(h);
        }
        yearWorkedCents += workedCents;
        let total = Math.floor((yearWorkedCents * cents(policy.hoursEarned)) / cents(policy.perHoursWorked) + 1e-9);
        if (capCents !== null) total = Math.min(total, capCents);
        const earned = Math.max(0, total - yearAccruedCents);
        yearAccruedCents += earned;
        if (workedCents === 0 && earned === 0) continue;
        entries.push({
          employeeId: emp.id,
          periodStart: period.start,
          periodEnd: period.end,
          hours: earned / 100,
          workedHours: workedCents / 100,
        });
      } else {
        // Employed for the whole period.
        if (emp.startDate && emp.startDate > period.start) continue;
        if (emp.endDate && emp.endDate < period.end) continue;
        let earned = cents(policy.hoursEarned);
        if (capCents !== null) earned = Math.max(0, Math.min(earned, capCents - yearAccruedCents));
        yearAccruedCents += earned;
        if (earned === 0) continue;
        entries.push({
          employeeId: emp.id,
          periodStart: period.start,
          periodEnd: period.end,
          hours: earned / 100,
          workedHours: null,
        });
      }
    }
  }
  return entries;
}

// ── Paid leave in payroll ───────────────────────────────────────────────────

export type PaidLeaveDay = {
  employeeId: number;
  date: string;
  leaveType: LeaveType;
  hours: number;
};

export type PaidLeaveTotals = { ptoHours: number; sickHours: number };

// Per employee and day, the paid leave hours by type.
export function paidLeaveByEmployeeDay(days: PaidLeaveDay[]): Map<number, Map<string, PaidLeaveTotals>> {
  const out = new Map<number, Map<string, PaidLeaveTotals>>();
  for (const d of days) {
    const byDay = out.get(d.employeeId) ?? new Map<string, PaidLeaveTotals>();
    const t = byDay.get(d.date) ?? { ptoHours: 0, sickHours: 0 };
    if (d.leaveType === "pto") t.ptoHours = round2(t.ptoHours + d.hours);
    else t.sickHours = round2(t.sickHours + d.hours);
    byDay.set(d.date, t);
    out.set(d.employeeId, byDay);
  }
  return out;
}
