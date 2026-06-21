import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";
import { validateContactInfo } from "@/lib/contact-info";

export const dynamic = "force-dynamic";

// Resolve which employee a request targets. Employees may only act on their own
// record; managers may target anyone via employeeId. Returns null when the
// caller isn't allowed to act on the requested target.
function resolveTarget(
  isManager: boolean,
  ownEmployeeId: number | null,
  requested: number | null
): number | null {
  if (requested == null) return ownEmployeeId;
  if (isManager) return requested;
  return requested === ownEmployeeId ? ownEmployeeId : null;
}

// GET /api/employees/contact?employeeId= — own contact, or any employee's for a
// manager.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("employeeId") ? Number(searchParams.get("employeeId")) : null;

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;
  const targetId = resolveTarget(isManager, employeeId, requested);
  if (targetId == null)
    return NextResponse.json({ error: "Not authorized for that employee" }, { status: 403 });

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name, phone, emergency_contact_name, emergency_contact_phone")
    .eq("org_id", orgId)
    .eq("id", targetId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  return NextResponse.json({
    employeeId: emp.id,
    name: emp.name,
    phone: emp.phone ?? null,
    emergencyContactName: emp.emergency_contact_name ?? null,
    emergencyContactPhone: emp.emergency_contact_phone ?? null,
  });
}

// PUT /api/employees/contact { employeeId?, phone?, emergencyContactName?,
// emergencyContactPhone? } — update own contact, or any employee's for a manager.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requested = Number.isInteger(body.employeeId) ? body.employeeId : null;

  const check = validateContactInfo(body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, isManager, employeeId } = ctx!;
  const targetId = resolveTarget(isManager, employeeId, requested);
  if (targetId == null)
    return NextResponse.json({ error: "Not authorized for that employee" }, { status: 403 });

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", targetId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { error: updateError } = await supabase
    .from("employees")
    .update({
      phone: check.value.phone,
      emergency_contact_name: check.value.emergencyContactName,
      emergency_contact_phone: check.value.emergencyContactPhone,
    })
    .eq("org_id", orgId)
    .eq("id", targetId);

  if (updateError) {
    console.error("[api/employees/contact]", updateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.contact_update",
    orgId,
    actorId:      user.id,
    resourceType: "employee",
    resourceId:   String(targetId),
    after:        { hasPhone: check.value.phone != null, hasEmergencyContact: check.value.emergencyContactName != null },
    metadata:     { employeeName: emp.name },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
