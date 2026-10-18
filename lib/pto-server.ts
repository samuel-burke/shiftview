// Server-side PTO: reading policies, balances and paid leave, deciding and
// cancelling requests, and posting accruals. The rules themselves are in the
// database (migration 0064) and lib/pto.ts; this is the plumbing the routes
// share, kept here so the time-off routes only call into it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { computePayroll, payrollQueryWindow, type PunchRow } from "@/lib/payroll";
import { dateKeyInTz } from "@/lib/dates";
import {
  accrualWindow,
  computeAccrualEntries,
  defaultPaidHours,
  isLeaveType,
  LEAVE_TYPES,
  parsePolicies,
  POLICY_SETTING_KEYS,
  type LeaveType,
  type PaidLeaveDay,
  type PtoPolicies,
  type RequestLeaveType,
} from "@/lib/pto";

export async function loadPtoPolicies(supabase: SupabaseClient, orgId: string): Promise<PtoPolicies> {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId)
    .in("key", Object.values(POLICY_SETTING_KEYS));
  const rows = Array.isArray(data) ? (data as { key: string; value: string }[]) : [];
  return parsePolicies(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

export type PtoBalance = { employeeId: number; pto: number; sick: number };

// Balances for one employee, or everyone in the org (managers). Employees
// with no ledger rows have no balance row: they read as 0.
export async function loadBalances(
  supabase: SupabaseClient,
  orgId: string,
  employeeId?: number,
): Promise<{ balances: PtoBalance[]; error: unknown }> {
  const { data, error } = await fetchAllRows<{ employee_id: number; leave_type: string; balance: number | string }>((first, last) => {
    let q = supabase
      .from("pto_balances")
      .select("employee_id, leave_type, balance")
      .eq("org_id", orgId);
    if (employeeId !== undefined) q = q.eq("employee_id", employeeId);
    return q.order("employee_id").order("leave_type").range(first, last);
  });
  const byEmp = new Map<number, PtoBalance>();
  for (const r of data) {
    const b = byEmp.get(r.employee_id) ?? { employeeId: r.employee_id, pto: 0, sick: 0 };
    if (isLeaveType(r.leave_type)) b[r.leave_type] = Number(r.balance);
    byEmp.set(r.employee_id, b);
  }
  return { balances: [...byEmp.values()], error };
}

// Approved paid leave in [from, to], for payroll and the time card.
export async function loadPaidLeave(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  employeeId?: number,
): Promise<{ days: PaidLeaveDay[]; error: unknown }> {
  const { data, error } = await fetchAllRows<{ id: number; employee_id: number; date: string; leave_type: string; paid_hours: number | string | null }>((first, last) => {
    let q = supabase
      .from("time_off_requests")
      .select("id, employee_id, date, leave_type, paid_hours")
      .eq("org_id", orgId)
      .eq("status", "approved")
      .in("leave_type", LEAVE_TYPES as unknown as string[])
      .gte("date", from)
      .lte("date", to);
    if (employeeId !== undefined) q = q.eq("employee_id", employeeId);
    return q.order("date").order("id").range(first, last);
  });
  const days: PaidLeaveDay[] = [];
  for (const r of data) {
    if (!isLeaveType(r.leave_type) || r.paid_hours == null) continue;
    days.push({ employeeId: r.employee_id, date: String(r.date).slice(0, 10), leaveType: r.leave_type, hours: Number(r.paid_hours) });
  }
  return { days, error };
}

// Names of employees with paid leave but no punches in a payroll report.
export async function loadPaidLeaveNames(
  supabase: SupabaseClient,
  orgId: string,
  worked: { employeeId: number }[],
  leave: PaidLeaveDay[],
): Promise<Record<number, string>> {
  const known = new Set(worked.map((e) => e.employeeId));
  const ids = [...new Set(leave.map((d) => d.employeeId))].filter((id) => !known.has(id));
  if (ids.length === 0) return {};
  const { data } = await supabase.from("employees").select("id, name").eq("org_id", orgId).in("id", ids);
  const rows = Array.isArray(data) ? (data as { id: number; name: string }[]) : [];
  return Object.fromEntries(rows.map((e) => [e.id, e.name]));
}

// The default paid hours for a request: the day's scheduled hours, else 8.
// (Kept separate so a part-day request can pass its own minutes later.)
export async function paidHoursForDay(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: number,
  date: string,
  tz: string,
): Promise<number> {
  const { data } = await supabase
    .from("schedules")
    .select("start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("date", date);
  const rows = Array.isArray(data) ? (data as { start_minutes: number; end_minutes: number }[]) : [];
  return defaultPaidHours(rows.map((s) => ({ startMinutes: s.start_minutes, endMinutes: s.end_minutes })), date, tz);
}

// The type and hours a new request is stored with. Paid hours the employee
// gives are kept (the manager can change them when approving).
export async function requestLeaveFields(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: number,
  date: string,
  tz: string,
  leaveType: RequestLeaveType,
  paidHours: number | undefined,
): Promise<{ leave_type: RequestLeaveType; paid_hours: number | null }> {
  if (leaveType === "unpaid") return { leave_type: "unpaid", paid_hours: null };
  return {
    leave_type: leaveType,
    paid_hours: paidHours ?? (await paidHoursForDay(supabase, orgId, employeeId, date, tz)),
  };
}

export type DecideResult =
  | { status: "ok"; leaveType?: RequestLeaveType; paidHours?: number | null; balance?: number | null; unchanged?: boolean }
  | { status: "insufficient"; leaveType: LeaveType; balance: number | null; hours: number | null; message?: string }
  | { status: "not_found" | "conflict" | "invalid" | "error"; current?: string; message?: string };

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export async function decideTimeOff(
  supabase: SupabaseClient,
  id: number,
  status: "approved" | "denied",
  opts: { leaveType?: RequestLeaveType; paidHours?: number; allowNegative?: boolean } = {},
): Promise<DecideResult> {
  const { data, error } = await supabase.rpc("decide_time_off", {
    p_request: id,
    p_status: status,
    p_leave_type: opts.leaveType ?? null,
    p_paid_hours: opts.paidHours ?? null,
    p_allow_negative: !!opts.allowNegative,
  });
  if (error) {
    // The ledger's backstops (0064): not enough balance, or a locked request.
    if ((error as { code?: string }).code === "TO001")
      return { status: "insufficient", leaveType: "pto", balance: null, hours: null, message: (error as { message?: string }).message };
    if ((error as { code?: string }).code === "TO002")
      return { status: "conflict", message: (error as { message?: string }).message };
    console.error("[pto] decide_time_off", error);
    return { status: "error" };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  switch (r.status) {
    case "ok":
      return {
        status: "ok",
        leaveType: r.leave_type as RequestLeaveType | undefined,
        paidHours: num(r.paid_hours),
        balance: num(r.balance),
        unchanged: r.unchanged === true,
      };
    case "insufficient":
      return { status: "insufficient", leaveType: r.leave_type as LeaveType, balance: Number(r.balance), hours: Number(r.hours) };
    case "not_found":
    case "conflict":
    case "invalid":
      return { status: r.status, current: r.current as string | undefined };
    default:
      return { status: "error" };
  }
}

export async function cancelTimeOff(
  supabase: SupabaseClient,
  id: number,
): Promise<{ status: "ok" | "not_found" | "past" | "conflict" | "error"; was?: string }> {
  const { data, error } = await supabase.rpc("cancel_time_off", { p_request: id });
  if (error) {
    console.error("[pto] cancel_time_off", error);
    return { status: "error" };
  }
  const r = (data ?? {}) as { status?: string; was?: string };
  if (r.status === "ok" || r.status === "not_found" || r.status === "past" || r.status === "conflict")
    return { status: r.status, was: r.was };
  return { status: "error" };
}

export type AccrualRunResult = {
  leaveType: LeaveType;
  window: { windowStart: string; through: string } | null;
  entries: number;
  accrualRows: number;
  carryoverRows: number;
};

// Recomputes each enabled policy's accruals from worked hours (payroll's
// count, via computePayroll) and has post_pto_accruals reconcile the ledger.
// Safe to run any number of times.
export async function syncAccruals(
  supabase: SupabaseClient,
  orgId: string,
  tz: string,
  todayKey: string,
): Promise<{ results: AccrualRunResult[]; error: string | null }> {
  const policies = await loadPtoPolicies(supabase, orgId);
  const results: AccrualRunResult[] = [];

  const { data: emps, error: empErr } = await fetchAllRows<{ id: number; name: string; hire_date: string | null; created_at: string; archived_at: string | null }>((first, last) =>
    supabase
      .from("employees")
      .select("id, name, hire_date, created_at, archived_at")
      .eq("org_id", orgId)
      .order("id")
      .range(first, last),
  );
  if (empErr) return { results, error: "Couldn't read employees" };
  const employees = emps.map((e) => ({
    id: e.id,
    startDate: e.hire_date ? String(e.hire_date).slice(0, 10) : e.created_at ? dateKeyInTz(e.created_at, tz) : null,
    endDate: e.archived_at ? dateKeyInTz(e.archived_at, tz) : null,
  }));

  for (const leaveType of LEAVE_TYPES) {
    const policy = policies[leaveType];
    const window = accrualWindow(policy, todayKey);
    if (!window) {
      results.push({ leaveType, window: null, entries: 0, accrualRows: 0, carryoverRows: 0 });
      continue;
    }

    const workedByDay: Record<number, Record<string, number>> = {};
    if (policy.method === "per_hours_worked") {
      const span = payrollQueryWindow(window.windowStart, window.through, tz);
      const { data, error, truncated } = await fetchAllRows((first, last) =>
        supabase
          .from("punch_records")
          .select("id, employee_id, punch_type, punched_at")
          .eq("org_id", orgId)
          .gte("punched_at", span.start)
          .lte("punched_at", span.end)
          .order("employee_id")
          .order("punched_at")
          .order("id")
          .range(first, last),
      );
      if (error) return { results, error: "Couldn't read punches" };
      // Accruing from a partial set of punches would under-credit silently.
      if (truncated) return { results, error: "Too many punches to compute accruals" };
      const rows = (data as Omit<PunchRow, "employees">[]).map((r) => ({ ...r, employees: null }));
      for (const emp of computePayroll(rows, tz, { from: window.windowStart, to: window.through })) {
        const days: Record<string, number> = {};
        for (const w of emp.weeks) for (const d of w.days) days[d.date] = d.workedHours;
        workedByDay[emp.employeeId] = days;
      }
    }

    const entries = computeAccrualEntries({ policy, window, employees, workedByDay });
    const { data: posted, error: rpcErr } = await supabase.rpc("post_pto_accruals", {
      p_org: orgId,
      p_leave_type: leaveType,
      p_window_start: window.windowStart,
      p_through: window.through,
      p_carryover_cap: policy.carryoverCap,
      p_entries: entries.map((e) => ({
        employee_id: e.employeeId,
        period_start: e.periodStart,
        period_end: e.periodEnd,
        hours: e.hours,
        worked_hours: e.workedHours,
      })),
    });
    const r = (posted ?? {}) as { status?: string; accrual_rows?: number; carryover_rows?: number };
    if (rpcErr || r.status !== "ok") {
      if (rpcErr) console.error("[pto] post_pto_accruals", rpcErr);
      return { results, error: r.status === "forbidden" ? "Manager access required" : "Couldn't post accruals" };
    }
    results.push({
      leaveType,
      window,
      entries: entries.length,
      accrualRows: r.accrual_rows ?? 0,
      carryoverRows: r.carryover_rows ?? 0,
    });
  }
  return { results, error: null };
}
