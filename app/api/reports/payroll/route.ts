import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { computePayroll, payrollQueryWindow, PunchRow } from "@/lib/payroll";
import { daysBetweenKeys } from "@/lib/dates";
import { loadPayrollPeriodInfo } from "@/lib/pay-periods-server";
import { getOrgPayrollSettings, loadExemptEmployeeIds } from "@/lib/pay-rules";

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

  const { tz, rules } = await getOrgPayrollSettings(supabase, orgId!);
  const { ids: exemptEmployeeIds, error: exemptError } = await loadExemptEmployeeIds(supabase, orgId!);
  if (exemptError) {
    console.error("[api/reports/payroll] exempt", exemptError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const span = payrollQueryWindow(from, to, tz, rules.workweekStartDay);
  const { data, error, truncated } = await fetchAllRows((first, last) =>
    supabase
      .from("punch_records")
      .select("id, employee_id, punch_type, punched_at, employees!punch_records_employee_org_fkey(name)")
      .eq("org_id", orgId!)
      .gte("punched_at", span.start)
      .lte("punched_at", span.end)
      .order("employee_id")
      .order("punched_at")
      .order("id")
      .range(first, last)
  );

  if (error) {
    console.error("[api/reports/payroll]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // Paying from a partial set of punches would underpay silently.
  if (truncated)
    return NextResponse.json({ error: "Too many punches in this range — choose a shorter range" }, { status: 422 });

  const rows = computePayroll(data as unknown as PunchRow[], tz, { from, to }, { rules, exemptEmployeeIds });

  // The pay period the range covers, its status and sign-offs (null when the
  // store doesn't use pay periods).
  const { info: payPeriod, error: periodError } = await loadPayrollPeriodInfo(supabase, orgId!, from, to);
  if (periodError) {
    console.error("[api/reports/payroll] pay periods", periodError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // The rules the hours were split by, so the report can say so.
  return NextResponse.json({ rows, from, to, rules, payPeriod });
}
