import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data, error } = await supabase.rpc("notify_get_manager_ids");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ managerUserIds: (data ?? []).map((r: { user_id: string }) => r.user_id) });
}
