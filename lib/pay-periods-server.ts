// Reading pay periods for the API: the org's setting, the periods recorded in
// pay_periods (migration 0062) merged with the ones the setting implies, and
// each period's employee sign-offs. Writes go through the database functions
// (pay_period_approve / _lock / _reopen / _sign), never the tables.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parsePayPeriodSettings,
  payPeriodContaining,
  payPeriodsOverlapping,
  type PayPeriodRange,
  type PayPeriodSettings,
  type PayPeriodStatus,
} from "@/lib/pay-periods";

export type PayPeriodSignoffStatus = "signed" | "disputed";

export type PayPeriodSignoff = {
  employeeId: number;
  status: PayPeriodSignoffStatus;
  note: string | null;
  signedAt: string;
};

export type PayPeriodView = PayPeriodRange & {
  // null until someone has acted on the period (it is open).
  id: number | null;
  status: PayPeriodStatus;
  approvedAt: string | null;
  lockedAt: string | null;
  signoffs: PayPeriodSignoff[];
};

type PeriodRow = {
  id: number;
  start_date: string;
  end_date: string;
  status: PayPeriodStatus;
  approved_at: string | null;
  locked_at: string | null;
};

type SignoffRow = {
  period_id: number;
  employee_id: number;
  status: PayPeriodSignoffStatus;
  note: string | null;
  signed_at: string;
};

export async function loadPayPeriodSettings(supabase: SupabaseClient, orgId: string): Promise<PayPeriodSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId)
    .like("key", "pay_period_%");
  const rows = Array.isArray(data) ? (data as { key: string; value: string }[]) : [];
  return parsePayPeriodSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

function openView(range: PayPeriodRange): PayPeriodView {
  return { ...range, id: null, status: "open", approvedAt: null, lockedAt: null, signoffs: [] };
}

// The periods touching [from, to]: recorded ones as recorded (they keep their
// dates if the setting changed since), the rest as the setting computes them.
// `employeeId` limits sign-offs to that employee's own.
export async function loadPayPeriods(
  supabase: SupabaseClient,
  orgId: string,
  settings: PayPeriodSettings,
  from: string,
  to: string,
  opts: { employeeId?: number } = {},
): Promise<{ periods: PayPeriodView[]; error: unknown }> {
  const { data, error } = await supabase
    .from("pay_periods")
    .select("id, start_date, end_date, status, approved_at, locked_at")
    .eq("org_id", orgId)
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date");
  if (error) return { periods: [], error };
  const stored = (Array.isArray(data) ? (data as PeriodRow[]) : []).map((r): PayPeriodView => ({
    id: r.id,
    start: r.start_date,
    end: r.end_date,
    status: r.status,
    approvedAt: r.approved_at,
    lockedAt: r.locked_at,
    signoffs: [],
  }));
  const computed = payPeriodsOverlapping(from, to, settings)
    .filter((c) => !stored.some((s) => s.start <= c.end && s.end >= c.start))
    .map(openView);
  const periods = [...stored, ...computed].sort((a, b) => a.start.localeCompare(b.start));

  const ids = stored.map((p) => p.id!);
  if (ids.length > 0) {
    let q = supabase
      .from("pay_period_signoffs")
      .select("period_id, employee_id, status, note, signed_at")
      .eq("org_id", orgId)
      .in("period_id", ids);
    if (opts.employeeId !== undefined) q = q.eq("employee_id", opts.employeeId);
    const { data: signoffData, error: signoffError } = await q;
    if (signoffError) return { periods: [], error: signoffError };
    for (const s of Array.isArray(signoffData) ? (signoffData as SignoffRow[]) : []) {
      periods.find((p) => p.id === s.period_id)?.signoffs.push({
        employeeId: s.employee_id,
        status: s.status,
        note: s.note,
        signedAt: s.signed_at,
      });
    }
  }
  return { periods, error: null };
}

// The period containing `date`: recorded, or computed from the setting.
export async function loadPayPeriodFor(
  supabase: SupabaseClient,
  orgId: string,
  settings: PayPeriodSettings,
  date: string,
  opts: { employeeId?: number } = {},
): Promise<{ period: PayPeriodView | null; error: unknown }> {
  const { periods, error } = await loadPayPeriods(supabase, orgId, settings, date, date, opts);
  if (error) return { period: null, error };
  if (periods[0]) return { period: periods[0], error: null };
  const computed = payPeriodContaining(date, settings);
  return { period: computed ? openView(computed) : null, error: null };
}

// What the database's pay-period refusals mean to the caller.
export function payPeriodErrorResponse(error: { code?: string; message?: string } | null | undefined, context: string): NextResponse {
  const message = error?.message || "Request failed";
  switch (error?.code) {
    case "PP001":   // the time is in a locked pay period
    case "55000":   // wrong state: already locked, not approved, already open
    case "23P01":   // overlaps a period recorded under an earlier setting
      return NextResponse.json({ error: message, code: error.code }, { status: 409 });
    case "22023":   // not ended yet, no pay periods, missing reason or note
      return NextResponse.json({ error: message }, { status: 400 });
    case "42501":
      return NextResponse.json({ error: message }, { status: 403 });
    default:
      console.error(`[${context}]`, error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export type PayrollPeriodInfo = {
  // The pay period the range is exactly, or null when it isn't one.
  period: PayPeriodView | null;
  // Every period the range touches.
  overlapping: PayPeriodView[];
};

// What a payroll range covers, for the report and the export. null when the
// store doesn't use pay periods: payroll is any date range, as before.
export async function loadPayrollPeriodInfo(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<{ info: PayrollPeriodInfo | null; error: unknown }> {
  const settings = await loadPayPeriodSettings(supabase, orgId);
  if (settings.frequency === "none") return { info: null, error: null };
  const { periods, error } = await loadPayPeriods(supabase, orgId, settings, from, to);
  if (error) return { info: null, error };
  return {
    info: { period: periods.find((p) => p.start === from && p.end === to) ?? null, overlapping: periods },
    error: null,
  };
}

// The line an export carries about its period, e.g.
// "Pay period 2026-10-05 to 2026-10-11: Locked".
export function payrollPeriodLabel(info: PayrollPeriodInfo): string {
  if (!info.period) return "Not a single pay period: check the dates before paying";
  const status = info.period.status === "locked" ? "Locked"
    : info.period.status === "approved" ? "Approved, not locked: hours can still change"
    : "Open, not locked: hours can still change";
  return `Pay period ${info.period.start} to ${info.period.end}: ${status}`;
}

// "_locked" for a locked period, "_NOT_LOCKED" for anything else, so an
// export taken before the hours were final says so wherever the file goes.
export function payrollPeriodFileSuffix(info: PayrollPeriodInfo): string {
  return info.period?.status === "locked" ? "_locked" : "_NOT_LOCKED";
}

// A punch or correction write refused because its time is in a locked period.
export function isPayPeriodLockedError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PP001";
}
