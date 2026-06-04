import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { computePayroll, PunchRow } from "@/lib/payroll";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const daysDiff =
    (new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime()) / 86_400_000;
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const { data, error } = await supabase
    .from("punch_records")
    .select("id, employee_id, punch_type, punched_at, employees(name)")
    .gte("punched_at", `${from}T00:00:00+00:00`)
    .lte("punched_at", `${to}T23:59:59.999+00:00`)
    .order("employee_id")
    .order("punched_at")
    .limit(50_000);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = computePayroll((data ?? []) as unknown as PunchRow[]);
  return NextResponse.json({ rows, from, to });
}
