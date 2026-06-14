import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data, error } = await supabase.rpc("notify_get_manager_ids", { p_org_id: orgId });
  if (error) {
    console.error("[api/managers]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // The org's owner (at most one), so the UI can mark them and gate demotion.
  const { data: ownerRows } = await supabase
    .from("managers")
    .select("user_id")
    .eq("org_id", orgId!)
    .eq("is_owner", true);

  return NextResponse.json({
    managerUserIds: (data ?? []).map((r: { user_id: string }) => r.user_id),
    ownerUserIds: (ownerRows ?? []).map((r: { user_id: string }) => r.user_id),
  });
}
