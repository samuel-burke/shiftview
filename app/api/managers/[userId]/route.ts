import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";

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

  const { data: targetEmp } = await supabase
    .from("employees")
    .select("name")
    .eq("org_id", orgId!)
    .eq("user_id", userId)
    .maybeSingle();

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
