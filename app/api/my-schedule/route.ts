import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEMO_EMPLOYEE_ID = 1;

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const { data, error } = await supabase
      .from("schedules_demo")
      .select("*")
      .eq("employee_id", DEMO_EMPLOYEE_ID)
      .gte("date", from)
      .lte("date", to)
      .order("date");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      employeeId: DEMO_EMPLOYEE_ID,
      employeeName: null,
      schedules: mapSchedules(data ?? []),
    });
  }

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp) {
    return NextResponse.json({ employeeId: null, employeeName: null, schedules: [] });
  }

  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("employee_id", emp.id)
    .gte("date", from)
    .lte("date", to)
    .order("date");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    employeeId: emp.id,
    employeeName: emp.name,
    schedules: mapSchedules(data ?? []),
  });
}

function mapSchedules(data: any[]) {
  return data.map((s) => ({
    id: s.id,
    employeeId: s.employee_id,
    date: s.date,
    startMinutes: s.start_minutes,
    endMinutes: s.end_minutes,
  }));
}
