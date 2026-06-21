import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { weekDates } from "@/lib/draft-metrics";
import { fairnessSummary, classifyFairness } from "@/lib/hours-fairness";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/hours-fairness?weekStart=YYYY-MM-DD (manager-only)
// How evenly scheduled hours are spread across the team for the week, flagging
// who's getting noticeably fewer/more hours than average.
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

  const { data: rows, error } = await supabase
    .from("schedules")
    .select("employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6])
    .limit(10000);

  if (error) {
    console.error("[api/reports/hours-fairness]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const minutesByEmployee = new Map<number, number>();
  for (const s of rows ?? []) {
    minutesByEmployee.set(
      s.employee_id,
      (minutesByEmployee.get(s.employee_id) ?? 0) + (s.end_minutes - s.start_minutes)
    );
  }

  const employees = [...minutesByEmployee.entries()].map(([employeeId, totalMinutes]) => ({ employeeId, totalMinutes }));
  const summary = fairnessSummary(employees);
  const classified = classifyFairness(employees);

  const nameById = new Map<number, string>();
  if (employees.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", employees.map((e) => e.employeeId));
    for (const e of emps ?? []) nameById.set(e.id, e.name);
  }

  return NextResponse.json({
    weekStart,
    summary,
    employees: classified.map((r) => ({
      employeeId: r.employeeId,
      employeeName: nameById.get(r.employeeId) ?? "Unknown",
      totalMinutes: r.totalMinutes,
      totalHours: Math.round((r.totalMinutes / 60) * 10) / 10,
      deviationMinutes: r.deviationMinutes,
      status: r.status,
    })),
  });
}
