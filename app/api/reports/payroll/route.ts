import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { computePayroll, PunchRow } from "@/lib/payroll";
import { addDaysToKey, daysBetweenKeys, localDayBoundsUtc } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
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

  const daysDiff = daysBetweenKeys(from, to);
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const tz = await getOrgTimezone(supabase, orgId!);

  const { data, error } = await supabase
    .from("punch_records")
    .select("id, employee_id, punch_type, punched_at, employees!punch_records_employee_org_fkey(name)")
    .eq("org_id", orgId!)
    .gte("punched_at", localDayBoundsUtc(from, tz).start.toISOString())
    .lte("punched_at", localDayBoundsUtc(addDaysToKey(to, 1), tz).end.toISOString())
    .order("employee_id")
    .order("punched_at")
    .limit(50_000);

  if (error) {
    console.error("[api/reports/payroll]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = computePayroll((data ?? []) as unknown as PunchRow[], tz, { from, to });
  return NextResponse.json({ rows, from, to });
}
