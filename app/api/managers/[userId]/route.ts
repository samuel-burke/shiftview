import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

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
  const { user, error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  if (action === "demote" && userId === user!.id)
    return NextResponse.json({ error: "You cannot demote yourself" }, { status: 400 });

  const fn = action === "promote" ? "manager_promote" : "manager_demote";
  const { error } = await supabase.rpc(fn, { target_user_id: userId });

  if (error) {
    console.error("[api/managers]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
