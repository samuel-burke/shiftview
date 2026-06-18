import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { isMinor, minorShiftViolations, ageOn } from "@/lib/minor-rules";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/minor-compliance?date=YYYY-MM-DD (manager-only)
// Flags scheduled shifts worked by minors that violate youth-labor rules
// (default: ends after 10 PM, or longer than 8h). Employees with no recorded
// date of birth are skipped.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const { data: rows, error } = await supabase
    .from("schedules")
    .select("id, employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("date", date)
    .order("start_minutes", { ascending: true });

  if (error) {
    console.error("[api/reports/minor-compliance]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const shifts = rows ?? [];
  const ids = [...new Set(shifts.map((s) => s.employee_id))];

  const empById = new Map<number, { name: string; dob: string | null }>();
  if (ids.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name, date_of_birth")
      .eq("org_id", orgId)
      .in("id", ids);
    for (const e of emps ?? []) empById.set(e.id, { name: e.name, dob: e.date_of_birth ?? null });
  }

  const violations: {
    scheduleId: number;
    employeeId: number;
    employeeName: string;
    age: number;
    startMinutes: number;
    endMinutes: number;
    issues: string[];
  }[] = [];

  for (const s of shifts) {
    const emp = empById.get(s.employee_id);
    if (!emp?.dob || !isMinor(emp.dob, date)) continue;
    const issues = minorShiftViolations({ startMinutes: s.start_minutes, endMinutes: s.end_minutes });
    if (issues.length === 0) continue;
    violations.push({
      scheduleId: s.id,
      employeeId: s.employee_id,
      employeeName: emp.name,
      age: ageOn(emp.dob, date),
      startMinutes: s.start_minutes,
      endMinutes: s.end_minutes,
      issues,
    });
  }

  const minorsWithViolations = new Set(violations.map((v) => v.employeeId)).size;

  return NextResponse.json({
    date,
    violations,
    summary: { totalViolations: violations.length, minorsWithViolations },
  });
}
