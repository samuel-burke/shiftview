import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeCSV(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// GET /api/punches/export?from=YYYY-MM-DD&to=YYYY-MM-DD&employeeId=N
// Manager: all employees (or filtered by employeeId)
// Employee: own punches only
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const daysDiff = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const rangeStart = `${from}T00:00:00+00:00`;
  const rangeEnd   = `${to}T23:59:59.999+00:00`;

  let query = supabase
    .from("punch_records")
    .select("*, employees(name)")
    .gte("punched_at", rangeStart)
    .lte("punched_at", rangeEnd)
    .order("employee_id")
    .order("punched_at")
    .limit(10_000);

  if (!managerRow) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!emp) return NextResponse.json({ error: "No employee record" }, { status: 403 });
    query = query.eq("employee_id", emp.id);
  } else {
    const filterEmpId = searchParams.get("employeeId");
    if (filterEmpId) query = query.eq("employee_id", Number(filterEmpId));
  }

  const { data, error } = await query;
  if (error) {
    console.error("[api/punches/export GET]", error);
    return NextResponse.json({ error: "Failed to fetch punch records" }, { status: 500 });
  }

  const rows = data ?? [];

  const headers = ["Employee", "Date", "Time", "Punch Type", "Manual", "Note", "Lat", "Lng"];
  const lines = [headers.join(",")];

  for (const r of rows) {
    const punchedAt = new Date(r.punched_at);
    const date = punchedAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const time = punchedAt.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const empName = (r.employees as { name: string } | null)?.name ?? String(r.employee_id);
    lines.push([
      empName,
      date,
      time,
      r.punch_type,
      r.is_manual ? "yes" : "no",
      r.note ?? "",
      r.lat ?? "",
      r.lng ?? "",
    ].map(escapeCSV).join(","));
  }

  const csv = lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="timesheet_${from}_to_${to}.csv"`,
    },
  });
}
