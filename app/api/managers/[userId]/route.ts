import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
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

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server misconfiguration" },
      { status: 500 }
    );
  }

  if (action === "promote") {
    const { data, error } = await admin
      .from("managers")
      .upsert({ user_id: userId })
      .select("user_id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0)
      return NextResponse.json(
        { error: "Promote failed — check that SUPABASE_SERVICE_ROLE_KEY is set and the managers table allows service-role writes." },
        { status: 500 }
      );
  } else {
    const { data, error } = await admin
      .from("managers")
      .delete()
      .eq("user_id", userId)
      .select("user_id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0)
      return NextResponse.json(
        { error: "Demote failed — user may not be a manager, or SUPABASE_SERVICE_ROLE_KEY is missing." },
        { status: 500 }
      );
  }

  return NextResponse.json({ ok: true });
}
