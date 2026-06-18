import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { validateIncident } from "@/lib/incident";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/incidents?from=&to= (manager-only) — incidents in a date range with
// the involved employee's name. Sensitive, so manager-gated (and RLS-gated).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to)
    return NextResponse.json({ error: "from and to params required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data, error } = await supabase
    .from("incidents")
    .select("id, employee_id, date, severity, description, created_at")
    .eq("org_id", orgId!)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false });

  if (error) {
    console.error("[api/incidents]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ids = [...new Set((data ?? []).map((i) => i.employee_id).filter(Boolean) as number[])];
  const nameById = new Map<number, string>();
  if (ids.length > 0) {
    const { data: emps } = await supabase.from("employees").select("id, name").eq("org_id", orgId!).in("id", ids);
    for (const e of emps ?? []) nameById.set(e.id, e.name);
  }

  return NextResponse.json({
    incidents: (data ?? []).map((i) => ({
      id: i.id,
      employeeId: i.employee_id ?? null,
      employeeName: i.employee_id ? nameById.get(i.employee_id) ?? "Unknown" : null,
      date: i.date,
      severity: i.severity,
      description: i.description,
      createdAt: i.created_at,
    })),
  });
}

// POST /api/incidents { date, severity, description, employeeId? } — any member
// may file. Sensitive records aren't read back to the reporter, so this returns
// only an ok flag (no id), consistent with the manager-only read policy.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const check = validateIncident(body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const employeeRef = Number.isInteger(body.employeeId) ? body.employeeId : null;

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user } = ctx!;

  const { error: insertError } = await supabase
    .from("incidents")
    .insert(
      withOrg(orgId, {
        employee_id: employeeRef,
        reported_by: user.id,
        date: check.value.date,
        severity: check.value.severity,
        description: check.value.description,
      })
    );

  if (insertError) {
    console.error("[api/incidents]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action: "incident.report", orgId, actorId: user.id,
    resourceType: "incident",
    after: { date: check.value.date, severity: check.value.severity, employeeId: employeeRef },
  }).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 201 });
}
