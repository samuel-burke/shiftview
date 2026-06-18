import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { computePtoBalance } from "@/lib/pto-balance";

export const dynamic = "force-dynamic";

// GET /api/time-off/balance?employeeId=&year=
//   Employee → their own PTO balance for the year.
//   Manager  → any employee's balance via ?employeeId=.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : new Date().getFullYear();
  const employeeIdParam = searchParams.get("employeeId");

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;

  // Employees may only read their own balance; managers may target anyone.
  const targetId =
    isManager && employeeIdParam ? Number(employeeIdParam) : employeeId;
  if (targetId == null || !Number.isInteger(targetId))
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name, pto_allowance_days")
    .eq("org_id", orgId)
    .eq("id", targetId)
    .maybeSingle();

  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data: approved } = await supabase
    .from("time_off_requests")
    .select("date")
    .eq("org_id", orgId)
    .eq("employee_id", targetId)
    .eq("status", "approved")
    .gte("date", `${year}-01-01`)
    .lte("date", `${year}-12-31`);

  const dates = (approved ?? []).map((r) => r.date as string);
  const allowance = emp.pto_allowance_days == null ? null : Number(emp.pto_allowance_days);
  const balance = computePtoBalance(allowance, dates, year);

  return NextResponse.json({
    employeeId: emp.id,
    employeeName: emp.name,
    year,
    ...balance,
  });
}

// PUT /api/time-off/balance { employeeId, allowanceDays } — manager sets or
// clears (null) an employee's annual PTO allowance.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { employeeId, allowanceDays } = body;

  if (!Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (
    allowanceDays !== null &&
    (!Number.isInteger(allowanceDays) || allowanceDays < 0 || allowanceDays > 365)
  )
    return NextResponse.json(
      { error: "allowanceDays must be an integer 0–365, or null to clear" },
      { status: 400 }
    );

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { error: updateError } = await supabase
    .from("employees")
    .update({ pto_allowance_days: allowanceDays })
    .eq("org_id", orgId!)
    .eq("id", employeeId);

  if (updateError) {
    console.error("[api/time-off/balance]", updateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.pto_allowance",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "employee",
    resourceId:   String(employeeId),
    after:        { allowanceDays },
    metadata:     { employeeName: emp.name },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
