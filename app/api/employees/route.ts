import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/require-manager";
import { getOrgContext } from "@/lib/org-context";
import { isDemoOrgId } from "@/lib/demo-org";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const parts = (n: string) => {
      const p = n.trim().split(/\s+/);
      return { last: p.length > 1 ? p[p.length - 1] : p[0], first: p[0] };
    };
    const pa = parts(a.name);
    const pb = parts(b.name);
    return pa.last.localeCompare(pb.last) || pa.first.localeCompare(pb.first);
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error) {
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });
  }

  const { data, error: dbError } = await supabase
    .from("employees")
    .select("id, name, email, user_id")
    .eq("org_id", ctx!.orgId);
  if (dbError) {
    console.error("[api/employees]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(sortByName(data ?? []));
}

export async function PATCH(request: Request) {
  const { id, userId, name } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });
  if (userId !== undefined && userId !== null && typeof userId !== "string")
    return NextResponse.json(
      { error: "userId must be a string (UUID) or null to unlink" },
      { status: 400 }
    );
  if (name !== undefined && (typeof name !== "string" || !name.trim()))
    return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // Demo org: visitors may rename employees or unlink/claim a row for
  // themselves, but must not attach arbitrary real user ids to demo rows.
  if (
    isDemoOrgId(orgId!) &&
    typeof userId === "string" &&
    userId !== user!.id
  )
    return NextResponse.json(
      { error: "Linking other accounts is disabled in the demo organization" },
      { status: 403 }
    );

  const { data: before } = await supabase
    .from("employees")
    .select("id, name, email, user_id")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();

  const updates: Record<string, unknown> = {};
  if (userId !== undefined) updates.user_id = userId;
  if (name !== undefined) updates.name = name.trim();

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  const { error } = await supabase
    .from("employees")
    .update(updates)
    .eq("org_id", orgId!)
    .eq("id", id);

  if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "employee.update",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "employee",
    resourceId:   String(id),
    before:       before ? { name: before.name, email: before.email, userId: before.user_id } : null,
    after:        updates,
    metadata: {
      employeeId:   id,
      employeeName: before?.name ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // Fetch the employee first to get their linked auth user_id
  const { data: employee } = await supabase
    .from("employees")
    .select("id, user_id, name, email")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();

  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  if (employee.user_id && employee.user_id === user?.id)
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 403 });

  // Deleting a linked employee also removes their manager role and auth
  // account below, so it follows the owner policy: the owner can never be
  // removed, and in owned orgs only the owner may remove another manager.
  if (employee.user_id) {
    const { data: ownerRow } = await supabase
      .from("managers")
      .select("user_id")
      .eq("org_id", orgId!)
      .eq("is_owner", true)
      .maybeSingle();
    if (ownerRow?.user_id === employee.user_id)
      return NextResponse.json({ error: "The organization owner cannot be deleted" }, { status: 403 });
    if (ownerRow && ownerRow.user_id !== user?.id) {
      const { data: targetManager } = await supabase
        .from("managers")
        .select("user_id")
        .eq("org_id", orgId!)
        .eq("user_id", employee.user_id)
        .maybeSingle();
      if (targetManager)
        return NextResponse.json(
          { error: "Only the organization owner can remove a manager" },
          { status: 403 }
        );
    }
  }

  // Delete schedules first so FK constraint doesn't block employee removal
  const { error: scheduleError } = await supabase
    .from("schedules")
    .delete()
    .eq("org_id", orgId!)
    .eq("employee_id", id);
  if (scheduleError) {
    console.error("[api/employees]", scheduleError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const { data: deleted, error } = await supabase
    .from("employees")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("[api/employees]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!deleted || deleted.length === 0)
    return NextResponse.json({ error: "Employee not found or permission denied" }, { status: 404 });

  // Delete auth account and manager role if the employee had a linked user
  if (employee.user_id) {
    const admin = createAdminClient();
    await admin.from("managers").delete().eq("org_id", orgId!).eq("user_id", employee.user_id);
    await admin.auth.admin.deleteUser(employee.user_id);
  }

  writeAuditLog({
    action:       "employee.delete",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "employee",
    resourceId:   String(id),
    before: {
      name:   employee.name,
      email:  employee.email,
      userId: employee.user_id,
    },
    metadata: {
      employeeId:   id,
      employeeName: employee.name,
      email:        employee.email,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
