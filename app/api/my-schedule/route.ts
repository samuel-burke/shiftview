import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error === "No organization membership") {
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });
  }

  const { orgId, employeeId } = ctx!;

  if (employeeId == null) {
    return NextResponse.json({ employeeId: null, employeeName: null, schedules: [] });
  }

  // Fetch the employee name using the org-scoped employee record
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (!emp) {
    return NextResponse.json({ employeeId: null, employeeName: null, schedules: [] });
  }

  const { data, error: dbError } = await supabase
    .from("schedules")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", emp.id)
    .gte("date", from)
    .lte("date", to)
    .order("date");

  if (dbError) {
    console.error("[api/my-schedule]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    employeeId: emp.id,
    employeeName: emp.name,
    schedules: mapSchedules(data ?? []),
  });
}

type ScheduleRow = {
  id: number;
  employee_id: number;
  date: string;
  start_minutes: number;
  end_minutes: number;
};

function mapSchedules(data: ScheduleRow[]) {
  return data.map((s) => ({
    id: s.id,
    employeeId: s.employee_id,
    date: s.date,
    startMinutes: s.start_minutes,
    endMinutes: s.end_minutes,
  }));
}
