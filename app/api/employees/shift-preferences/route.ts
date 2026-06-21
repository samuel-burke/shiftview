import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";
import {
  validateShiftPreferences,
  serializeShiftPreferences,
  parseShiftPreferences,
} from "@/lib/shift-preferences";

export const dynamic = "force-dynamic";

// Employees may act on their own record; managers on anyone's.
function resolveTarget(isManager: boolean, own: number | null, requested: number | null): number | null {
  if (requested == null) return own;
  if (isManager) return requested;
  return requested === own ? own : null;
}

// GET /api/employees/shift-preferences?employeeId= — own preferences (or any
// employee's for a manager) as an array of shift types.
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
    .select("id, preferred_shift_types")
    .eq("org_id", orgId)
    .eq("id", targetId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  return NextResponse.json({
    employeeId: emp.id,
    shiftTypes: parseShiftPreferences(emp.preferred_shift_types ?? null),
  });
}

// PUT /api/employees/shift-preferences { employeeId?, shiftTypes } — set own
// preferences, or any employee's for a manager.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requested = Number.isInteger(body.employeeId) ? body.employeeId : null;

  const check = validateShiftPreferences(body.shiftTypes);
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
    .update({ preferred_shift_types: serializeShiftPreferences(check.value) })
    .eq("org_id", orgId)
    .eq("id", targetId);

  if (updateError) {
    console.error("[api/employees/shift-preferences]", updateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.shift_preferences",
    orgId,
    actorId:      user.id,
    resourceType: "employee",
    resourceId:   String(targetId),
    after:        { shiftTypes: check.value },
    metadata:     { employeeName: emp.name },
  }).catch(() => {});

  return NextResponse.json({ ok: true, shiftTypes: check.value });
}
