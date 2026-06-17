import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { upcomingAnniversaries } from "@/lib/tenure";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/anniversaries?asOf=YYYY-MM-DD&within=30 (manager-only)
// Upcoming work anniversaries in the next `within` days.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asOfParam = searchParams.get("asOf");
  const asOf = asOfParam && DATE_RE.test(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);
  const withinRaw = Number(searchParams.get("within") ?? "30");
  const within = Number.isInteger(withinRaw) && withinRaw > 0 && withinRaw <= 366 ? withinRaw : 30;

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const { data: emps, error } = await supabase
    .from("employees")
    .select("id, name, hire_date")
    .eq("org_id", orgId);

  if (error) {
    console.error("[api/reports/anniversaries]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const nameById = new Map<number, string>((emps ?? []).map((e) => [e.id, e.name]));
  const list = upcomingAnniversaries(
    (emps ?? []).map((e) => ({ employeeId: e.id, hireDate: e.hire_date ?? null })),
    asOf,
    within
  );

  return NextResponse.json({
    asOf,
    within,
    anniversaries: list.map((a) => ({ ...a, employeeName: nameById.get(a.employeeId) ?? "Unknown" })),
  });
}

// PUT /api/reports/anniversaries { employeeId, hireDate } (manager) — set or
// clear (null) an employee's hire date.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { employeeId, hireDate } = body;

  if (!Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (hireDate !== null && (typeof hireDate !== "string" || !DATE_RE.test(hireDate)))
    return NextResponse.json({ error: "hireDate must be YYYY-MM-DD or null" }, { status: 400 });

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
    .update({ hire_date: hireDate })
    .eq("org_id", orgId!)
    .eq("id", employeeId);

  if (updateError) {
    console.error("[api/reports/anniversaries]", updateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.hire_date",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "employee",
    resourceId:   String(employeeId),
    after:        { hireDate },
    metadata:     { employeeName: emp.name },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
