import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { weekDates } from "@/lib/draft-metrics";
import { summarizeWeeklyCost, type EmployeeCostInput } from "@/lib/labor-cost";
import { getOrgTimezone } from "@/lib/org-timezone";
import { shiftMinutes } from "@/lib/schedule-hours";
import { loadPayRates } from "@/lib/pay-rates";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/labor-cost?weekStart=YYYY-MM-DD (manager-only)
// Per-employee scheduled labor cost for the week (regular + overtime at 1.5×),
// plus the week total and a count of scheduled employees with no rate set.
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

  const { data: scheduleRows, error } = await supabase
    .from("schedules")
    .select("employee_id, date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6])
    .limit(10000);

  if (error) {
    console.error("[api/reports/labor-cost]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Aggregate scheduled minutes per employee for the week — real elapsed
  // minutes in the store's timezone, so a shift spanning a DST change is
  // costed for the hours actually worked.
  const tz = await getOrgTimezone(supabase, orgId!);
  const minutesByEmployee = new Map<number, number>();
  for (const s of scheduleRows ?? []) {
    minutesByEmployee.set(
      s.employee_id,
      (minutesByEmployee.get(s.employee_id) ?? 0) +
        shiftMinutes({ date: s.date, startMinutes: s.start_minutes, endMinutes: s.end_minutes }, tz)
    );
  }

  if (minutesByEmployee.size === 0) {
    return NextResponse.json({ weekStart, totalCost: 0, employeesMissingRate: 0, employees: [] });
  }

  const employeeIds = [...minutesByEmployee.keys()];
  const [{ data: employees }, { rates: rateById, error: rateError }] = await Promise.all([
    supabase.from("employees").select("id, name").eq("org_id", orgId).in("id", employeeIds),
    loadPayRates(supabase, orgId!),
  ]);
  if (rateError) {
    console.error("[api/reports/labor-cost] pay rates", rateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const nameById = new Map<number, string>();
  for (const e of employees ?? []) nameById.set(e.id, e.name);

  const inputs: EmployeeCostInput[] = employeeIds.map((id) => ({
    employeeId: id,
    totalMinutes: minutesByEmployee.get(id) ?? 0,
    payRate: rateById.get(id) ?? null,
  }));

  const summary = summarizeWeeklyCost(inputs);

  return NextResponse.json({
    weekStart,
    totalCost: summary.totalCost,
    employeesMissingRate: summary.employeesMissingRate,
    employees: summary.rows.map((r) => ({
      employeeId: r.employeeId,
      employeeName: nameById.get(r.employeeId) ?? "Unknown",
      totalMinutes: r.totalMinutes,
      totalHours: Math.round((r.totalMinutes / 60) * 10) / 10,
      overtimeMinutes: r.overtimeMinutes,
      payRate: rateById.get(r.employeeId) ?? null,
      cost: r.cost,
    })),
  });
}
