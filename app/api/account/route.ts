import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Self-serve account deletion: any authenticated user can delete their own
// account — including users with no org membership, so this authenticates via
// auth.getUser() directly instead of getOrgContext().
//
// What it removes: the auth user, their manager roles, and their personal
// tables (push subscriptions, notification preferences). Their employee rows
// are UNLINKED (user_id = null) rather than deleted: schedules and punch
// history are the organization's records (payroll), and an employee leaving
// must not destroy them. Managers can still delete the employee row later.
//
// Organization owners are refused: an owner's manager row cannot be removed
// (managers_protect_owner trigger), and an ownerless org would be orphaned.
// They must delete the organization first (DELETE /api/organizations).
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();

  const { data: ownedOrgs, error: ownedError } = await admin
    .from("managers")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("is_owner", true);
  if (ownedError) {
    console.error("[api/account]", ownedError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if ((ownedOrgs ?? []).length > 0)
    return NextResponse.json(
      { error: "You own an organization. Delete it in Settings before deleting your account." },
      { status: 409 }
    );

  // Memberships are collected up front: after the deletes below they are gone,
  // and the audit trail should record the departure in every org involved.
  const { data: managerRows } = await admin
    .from("managers")
    .select("org_id")
    .eq("user_id", user.id);
  const { data: employeeRows } = await admin
    .from("employees")
    .select("org_id")
    .eq("user_id", user.id);

  const { error: unlinkError } = await admin
    .from("employees")
    .update({ user_id: null })
    .eq("user_id", user.id);
  if (unlinkError) {
    console.error("[api/account]", unlinkError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const { error: managersError } = await admin
    .from("managers")
    .delete()
    .eq("user_id", user.id);
  if (managersError) {
    console.error("[api/account]", managersError);
    // The owner trigger backstops a race with the ownership check above.
    if ((managersError.message ?? "").includes("owner"))
      return NextResponse.json(
        { error: "You own an organization. Delete it in Settings before deleting your account." },
        { status: 409 }
      );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  await admin.from("push_subscriptions").delete().eq("user_id", user.id);
  await admin.from("user_notification_preferences").delete().eq("user_id", user.id);

  const { error: authError } = await admin.auth.admin.deleteUser(user.id);
  if (authError) {
    console.error("[api/account]", authError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const orgIds = new Set<string>([
    ...(managerRows ?? []).map((r) => r.org_id as string),
    ...(employeeRows ?? []).map((r) => r.org_id as string),
  ]);
  for (const orgId of orgIds) {
    writeAuditLog({
      action:       "account.delete",
      orgId,
      actorId:      user.id,
      resourceType: "user",
      resourceId:   user.id,
      metadata:     { email: user.email ?? null },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
