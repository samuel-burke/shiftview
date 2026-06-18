import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { certificationStatus } from "@/lib/certifications";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/certifications?employeeId=&today=
//   Employee → their own certifications.
//   Manager  → any employee's via ?employeeId=.
// Each row is annotated with a derived expiry status.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const todayParam = searchParams.get("today");
  const today = todayParam && DATE_RE.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);
  const employeeIdParam = searchParams.get("employeeId");

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;
  const targetId = isManager && employeeIdParam ? Number(employeeIdParam) : employeeId;
  if (targetId == null || !Number.isInteger(targetId))
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });

  const { data, error: dbError } = await supabase
    .from("certifications")
    .select("id, employee_id, name, issued_on, expires_on")
    .eq("org_id", orgId)
    .eq("employee_id", targetId)
    .order("expires_on", { ascending: true });

  if (dbError) {
    console.error("[api/certifications]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    certifications: (data ?? []).map((c) => ({
      id: c.id,
      employeeId: c.employee_id,
      name: c.name,
      issuedOn: c.issued_on,
      expiresOn: c.expires_on,
      status: certificationStatus(c.expires_on, today),
    })),
  });
}

// POST /api/certifications { employeeId, name, issuedOn?, expiresOn? } (manager)
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { employeeId, name, issuedOn, expiresOn } = body;

  if (!Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  for (const [label, v] of [["issuedOn", issuedOn], ["expiresOn", expiresOn]] as const) {
    if (v != null && (typeof v !== "string" || !DATE_RE.test(v)))
      return NextResponse.json({ error: `${label} must be YYYY-MM-DD` }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // The employee must belong to this org (also satisfies the composite FK).
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("certifications")
    .insert(
      withOrg(orgId!, {
        employee_id: employeeId,
        name: name.trim(),
        issued_on: issuedOn ?? null,
        expires_on: expiresOn ?? null,
      })
    )
    .select("id")
    .single();

  if (error) {
    console.error("[api/certifications]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "certification.create",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "certification",
    resourceId:   String(data.id),
    after:        { employeeId, name: name.trim(), expiresOn: expiresOn ?? null },
    metadata:     { employeeName: emp.name },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}

// DELETE /api/certifications { id } (manager)
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data: existing } = await supabase
    .from("certifications")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Certification not found" }, { status: 404 });

  const { error } = await supabase
    .from("certifications")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", id);

  if (error) {
    console.error("[api/certifications]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "certification.delete",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "certification",
    resourceId:   String(id),
    before:       { name: existing.name },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
