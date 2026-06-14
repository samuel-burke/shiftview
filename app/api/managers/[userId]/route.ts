import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { isDemoOrgId } from "@/lib/demo-org";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  if (action !== "promote" && action !== "demote")
    return NextResponse.json({ error: "action must be 'promote' or 'demote'" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  if (action === "demote" && userId === user!.id)
    return NextResponse.json({ error: "You cannot demote yourself" }, { status: 400 });

  // Owner policy: when the org has an owner (orgs created through sign-up),
  // only the owner may promote or demote, and the owner can never be demoted.
  // Orgs predating the sign-up flow have no owner; any manager may change
  // roles there, preserving the original behavior. The managers_protect_owner
  // DB trigger backstops the owner's immunity on every write path.
  const { data: ownerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("org_id", orgId!)
    .eq("is_owner", true)
    .maybeSingle();
  if (ownerRow && ownerRow.user_id !== user!.id)
    return NextResponse.json(
      { error: "Only the organization owner can change manager roles" },
      { status: 403 }
    );
  if (action === "demote" && ownerRow?.user_id === userId)
    return NextResponse.json({ error: "The organization owner cannot be demoted" }, { status: 403 });

  const { data: targetEmp } = await supabase
    .from("employees")
    .select("name")
    .eq("org_id", orgId!)
    .eq("user_id", userId)
    .maybeSingle();

  // Demo org: only users who already belong to the demo org can be promoted —
  // otherwise an anonymous visitor could attach arbitrary real user ids to
  // the demo tenant's managers table.
  if (isDemoOrgId(orgId!) && !targetEmp)
    return NextResponse.json(
      { error: "Only demo organization members can be promoted in the demo" },
      { status: 403 }
    );

  const fn = action === "promote" ? "manager_promote" : "manager_demote";
  const { error } = await supabase.rpc(fn, { target_user_id: userId });

  if (error) {
    console.error("[api/managers]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       action === "promote" ? "manager.promote" : "manager.demote",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "manager",
    resourceId:   userId,
    metadata: {
      targetUserId: userId,
      targetName:   targetEmp?.name ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
