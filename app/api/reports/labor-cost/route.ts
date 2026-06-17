import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { weekDates } from "@/lib/draft-metrics";
import { summarizeWeeklyCost, type EmployeeCostInput } from "@/lib/labor-cost";

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
    .select("employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6])
    .limit(10000);

  if (error) {
    console.error("[api/reports/labor-cost]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Aggregate scheduled minutes per employee for the week.
  const minutesByEmployee = new Map<number, number>();
  for (const s of scheduleRows ?? []) {
    minutesByEmployee.set(
      s.employee_id,
      (minutesByEmployee.get(s.employee_id) ?? 0) + (s.end_minutes - s.start_minutes)
    );
  }

  if (minutesByEmployee.size === 0) {
    return NextResponse.json({ weekStart, totalCost: 0, employeesMissingRate: 0, employees: [] });
  }

  const employeeIds = [...minutesByEmployee.keys()];
  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, pay_rate")
    .eq("org_id", orgId)
    .in("id", employeeIds);

  const nameById = new Map<number, string>();
  const rateById = new Map<number, number | null>();
  for (const e of employees ?? []) {
    nameById.set(e.id, e.name);
    rateById.set(e.id, e.pay_rate == null ? null : Number(e.pay_rate));
  }

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
