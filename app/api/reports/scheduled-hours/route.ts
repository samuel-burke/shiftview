import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { weekDates } from "@/lib/draft-metrics";
import {
  summarizeWeeklyHours,
  WEEKLY_OVERTIME_THRESHOLD_MINUTES,
  type EmployeeShift,
} from "@/lib/schedule-hours";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/scheduled-hours?weekStart=YYYY-MM-DD
// Per-employee scheduled hours for the week starting weekStart, with overtime
// (> 40h scheduled) flagged so managers can catch it before it's worked.
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

  const { data, error } = await supabase
    .from("schedules")
    .select("date, employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6])
    .limit(10000);

  if (error) {
    console.error("[api/reports/scheduled-hours]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const shifts: EmployeeShift[] = (data ?? []).map((s) => ({
    employeeId: s.employee_id,
    date: s.date,
    startMinutes: s.start_minutes,
    endMinutes: s.end_minutes,
  }));

  const rows = summarizeWeeklyHours(shifts, dates);

  // Resolve names for the employees that actually have hours this week.
  const names: Record<number, string> = {};
  if (rows.length > 0) {
    const { data: employees } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", rows.map((r) => r.employeeId));
    for (const e of employees ?? []) names[e.id] = e.name;
  }

  return NextResponse.json({
    weekStart,
    thresholdMinutes: WEEKLY_OVERTIME_THRESHOLD_MINUTES,
    employees: rows.map((r) => ({
      employeeId: r.employeeId,
      employeeName: names[r.employeeId] ?? "Unknown",
      totalMinutes: r.totalMinutes,
      totalHours: Math.round((r.totalMinutes / 60) * 10) / 10,
      overtimeMinutes: r.overtimeMinutes,
      isOvertime: r.isOvertime,
    })),
  });
}
