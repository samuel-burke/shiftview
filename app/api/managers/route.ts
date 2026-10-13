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

  // Read the org's managers directly (RLS: members see their org's rows).
  // notify_get_manager_ids is service-role only since migration 0038.
  const { data, error } = await supabase
    .from("managers")
    .select("user_id, is_owner")
    .eq("org_id", orgId!);
  if (error) {
    console.error("[api/managers]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = (data ?? []) as { user_id: string; is_owner: boolean | null }[];
  return NextResponse.json({
    managerUserIds: rows.map((r) => r.user_id),
    // The org's owner (at most one), so the UI can mark them and gate demotion.
    ownerUserIds: rows.filter((r) => r.is_owner).map((r) => r.user_id),
  });
}
