import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { weekDates } from "@/lib/draft-metrics";
import { scheduledCostByDay } from "@/lib/labor-cost";
import { getOrgTimezone } from "@/lib/org-timezone";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { computePayroll, payrollQueryWindow, type PunchRow } from "@/lib/payroll";
import { computePay, type CostPunch } from "@/lib/pay-cost";
import { loadPayContext } from "@/lib/pay-context-server";
import { apportion } from "@/lib/pay-rates";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/reports/labor-cost?weekStart=YYYY-MM-DD (manager-only)
//
// Scheduled and actual labor cost for the 7 days from weekStart, per employee
// and per day.
//   * Scheduled: scheduled time at the rate in effect on each hour's date, in
//     the shift's position; time past 40h in the 7 days is overtime at 1.5×.
//     employees / totalCost / employeesMissingRate are what this route always
//     returned.
//   * Actual: punched hours as payroll computes them (Monday workweeks, with
//     the hours before weekStart counting toward overtime), priced at the
//     rate in effect when they were worked (lib/pay-cost.ts): overtime at
//     1.5×, double time at 2× when the hours have it.
// Hours with no rate add nothing and are counted in employeesMissingRate.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get("weekStart");

  if (!weekStart || !DATE_RE.test(weekStart))
    return NextResponse.json({ error: "weekStart param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const dates = weekDates(weekStart);
  const tz = await getOrgTimezone(supabase, orgId!);
  const span = payrollQueryWindow(dates[0], dates[6], tz);

  const [schedules, punchRows] = await Promise.all([
    fetchAllRows((first, last) =>
      supabase
        .from("schedules")
        .select("id, employee_id, date, start_minutes, end_minutes, position_id")
        .eq("org_id", orgId)
        .gte("date", dates[0])
        .lte("date", dates[6])
        .order("id")
        .range(first, last)
    ),
    fetchAllRows((first, last) =>
      supabase
        .from("punch_records")
        .select("id, employee_id, schedule_id, punch_type, punched_at, employees!punch_records_employee_org_fkey(name)")
        .eq("org_id", orgId!)
        .gte("punched_at", span.start)
        .lte("punched_at", span.end)
        .order("employee_id")
        .order("punched_at")
        .order("id")
        .range(first, last)
    ),
  ]);

  if (schedules.error || punchRows.error) {
    console.error("[api/reports/labor-cost]", schedules.error ?? punchRows.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (schedules.truncated || punchRows.truncated)
    return NextResponse.json({ error: "Too much data in this week to cost" }, { status: 422 });

  type ScheduleRow = { id: number; employee_id: number; date: string; start_minutes: number; end_minutes: number; position_id?: number | null };
  const scheduleData = schedules.data as ScheduleRow[];
  const punches = punchRows.data as unknown as (PunchRow & CostPunch)[];

  const { ctx, error: payError } = await loadPayContext(supabase, orgId!, punches.map((p) => p.schedule_id));
  if (payError || !ctx) {
    console.error("[api/reports/labor-cost] pay rates", payError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // ── Scheduled ──
  const scheduled = scheduledCostByDay(
    scheduleData.map((s) => ({
      employeeId: s.employee_id,
      date: s.date,
      startMinutes: s.start_minutes,
      endMinutes: s.end_minutes,
      positionId: s.position_id ?? null,
    })),
    dates,
    ctx.rates,
    tz,
  );
  scheduled.sort((a, b) => {
    if (a.cost == null && b.cost == null) return a.employeeId - b.employeeId;
    if (a.cost == null) return 1;
    if (b.cost == null) return -1;
    return b.cost - a.cost || a.employeeId - b.employeeId;
  });

  // ── Actual ──
  const payroll = computePayroll(punches, tz, { from: dates[0], to: dates[6] });
  const pay = computePay(payroll, punches, ctx.rates, ctx.positionBySchedule, tz);
  const actualEmployees = payroll.map((emp) => {
    const p = pay.get(emp.employeeId)!;
    const days = Object.fromEntries(dates.map((d) => [d, (p.days.get(d)?.totalCents ?? 0) / 100]));
    const doubleTimeHours = round2(
      emp.weeks.reduce((s, w) => s + w.days.reduce((t, d) => t + ((d as { doubleTimeHours?: number }).doubleTimeHours ?? 0), 0), 0)
    );
    const rated = [...p.days.values()].some((d) => d.lines.some((l) => l.totalCents != null));
    return {
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      regularHours: emp.totalRegularHours,
      overtimeHours: emp.totalOvertimeHours,
      doubleTimeHours,
      totalHours: emp.totalWorkedHours,
      cost: rated ? p.totalCents / 100 : null,
      missingRate: p.missingRate,
      hasIncomplete: emp.weeks.some((w) => w.hasIncomplete),
      days,
    };
  });
  const actualTotalCents = [...pay.values()].reduce((s, p) => s + p.totalCents, 0);

  // ── Names (archived employees too: they worked this week) ──
  const ids = [...new Set([...scheduled.map((s) => s.employeeId), ...actualEmployees.map((a) => a.employeeId)])];
  const nameById = new Map<number, string>();
  for (const a of actualEmployees) nameById.set(a.employeeId, a.employeeName);
  if (ids.length > 0) {
    const { data: employees } = await supabase.from("employees").select("id, name").eq("org_id", orgId).in("id", ids);
    for (const e of (employees ?? []) as { id: number; name: string }[]) nameById.set(e.id, e.name);
  }

  const scheduledTotalCents = scheduled.reduce((s, r) => s + Math.round((r.cost ?? 0) * 100), 0);
  const scheduledDayCents = dates.map((d) => scheduled.reduce((s, r) => s + Math.round((r.days[d] ?? 0) * 100), 0));
  const actualDayCents = dates.map((d) => actualEmployees.reduce((s, a) => s + Math.round(a.days[d] * 100), 0));
  // Day totals add up to the week totals (they do already; apportion guards
  // against float drift in the per-employee splits).
  const schedDays = apportion(scheduledTotalCents, scheduledDayCents);
  const actDays = apportion(actualTotalCents, actualDayCents);

  return NextResponse.json({
    weekStart,
    totalCost: scheduledTotalCents / 100,
    employeesMissingRate: scheduled.filter((r) => r.missingRate && r.totalMinutes > 0).length,
    employees: scheduled.map((r) => ({
      employeeId: r.employeeId,
      employeeName: nameById.get(r.employeeId) ?? "Unknown",
      totalMinutes: r.totalMinutes,
      totalHours: Math.round((r.totalMinutes / 60) * 10) / 10,
      overtimeMinutes: r.overtimeMinutes,
      payRate: ctx.rates(r.employeeId, dates[0]).rate,
      cost: r.cost,
      days: r.days,
    })),
    days: dates.map((date, i) => ({
      date,
      scheduledCost: schedDays[i] / 100,
      actualCost: actDays[i] / 100,
    })),
    actual: {
      totalCost: actualTotalCents / 100,
      employeesMissingRate: actualEmployees.filter((a) => a.missingRate).length,
      hasIncomplete: actualEmployees.some((a) => a.hasIncomplete),
      employees: actualEmployees
        .map((a) => ({ ...a, employeeName: nameById.get(a.employeeId) ?? a.employeeName }))
        .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.employeeId - b.employeeId),
    },
  });
}
