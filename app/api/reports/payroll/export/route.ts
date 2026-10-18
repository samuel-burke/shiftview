import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { computePayroll, payrollQueryWindow, PunchRow } from "@/lib/payroll";
import { daysBetweenKeys } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";
import { writeAuditLog } from "@/lib/audit";
import { computePay, type CostPunch } from "@/lib/pay-cost";
import { loadPayContext } from "@/lib/pay-context-server";
import { EXPORT_FORMATS, renderExport, type ExportFormat } from "@/lib/payroll-export";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// ADP company codes are three letters or digits.
const ADP_CO_CODE_RE = /^[A-Za-z0-9]{3}$/;

// GET /api/reports/payroll/export?from&to&format[&coCode] (manager-only)
// The file formats live in lib/payroll-export.ts, with the providers' import
// layouts they follow. Dollars are at the rate in effect when each hour was
// worked (lib/pay-cost.ts).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { searchParams } = new URL(request.url);
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");
  // An unknown format gets the summary, as it always has.
  const asked = searchParams.get("format") ?? "summary";
  const format: ExportFormat = (EXPORT_FORMATS as readonly string[]).includes(asked) ? (asked as ExportFormat) : "summary";
  const coCode = searchParams.get("coCode") ?? "";

  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const daysDiff = daysBetweenKeys(from, to);
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });
  if (format === "adp" && !ADP_CO_CODE_RE.test(coCode))
    return NextResponse.json({ error: "ADP needs your 3-character company code (coCode)" }, { status: 400 });

  const tz = await getOrgTimezone(supabase, orgId!);

  const span = payrollQueryWindow(from, to, tz);
  const { data, error, truncated } = await fetchAllRows((first, last) =>
    supabase
      .from("punch_records")
      .select("id, employee_id, schedule_id, punch_type, punched_at, employees!punch_records_employee_org_fkey(name)")
      .eq("org_id", orgId!)
      .gte("punched_at", span.start)
      .lte("punched_at", span.end)
      .order("employee_id")
      .order("punched_at")
      .order("id")
      .range(first, last)
  );

  if (error) {
    console.error("[api/reports/payroll/export]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // Paying from a partial set of punches would underpay silently.
  if (truncated)
    return NextResponse.json({ error: "Too many punches in this range — choose a shorter range" }, { status: 422 });

  const punches = data as unknown as (PunchRow & CostPunch)[];
  const payroll = computePayroll(punches, tz, { from, to });

  const { ctx, error: payError } = await loadPayContext(supabase, orgId!, punches.map((p) => p.schedule_id));
  if (payError || !ctx) {
    console.error("[api/reports/payroll/export] pay rates", payError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const pay = computePay(payroll, punches, ctx.rates, ctx.positionBySchedule, tz);

  writeAuditLog({
    action:       "payroll.export",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "punch_record",
    metadata:     { from, to, format, employeeCount: payroll.length },
  }).catch(() => {});

  const { content, contentType, filename } = renderExport(format, payroll, {
    from,
    to,
    pay,
    payrollIds: ctx.payrollIds,
    positionNames: ctx.positionNames,
    adpCoCode: coCode,
  });

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
