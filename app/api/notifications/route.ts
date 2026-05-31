import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// GET /api/notifications?limit=20 — fetch recent notifications for the authenticated user
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30", 10), 100);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json([]);

  const { data: managerRow } = await supabase
    .from("managers").select("user_id").eq("user_id", user.id).maybeSingle();

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("is_cleared", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (managerRow) {
    // Managers see their own + broadcast (user_id = null)
    query = query.or(`user_id.eq.${user.id},user_id.is.null`);
  } else {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[api/notifications]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// PATCH /api/notifications — mark notification(s) as read
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: "ids array required" }, { status: 400 });

  // Validate all IDs are positive integers
  if (!ids.every((id) => Number.isInteger(id) && id > 0))
    return NextResponse.json({ error: "ids must be positive integers" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: managerRow } = await supabase
    .from("managers").select("user_id").eq("user_id", user.id).maybeSingle();

  // Explicit ownership filter — defense-in-depth on top of RLS.
  // Regular users may only mark their own rows; managers also include broadcasts (user_id IS NULL).
  let query = supabase
    .from("notifications")
    .update({ read: true })
    .in("id", ids);

  if (managerRow) {
    query = query.or(`user_id.eq.${user.id},user_id.is.null`);
  } else {
    query = query.eq("user_id", user.id);
  }

  const { error } = await query;
  if (error) {
    console.error("[api/notifications PATCH]", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/notifications — soft-delete (set is_cleared=true) for one or all notifications
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { id, all } = body as { id?: unknown; all?: unknown };

  if (id === undefined && !all)
    return NextResponse.json({ error: "id or all required" }, { status: 400 });

  if (id !== undefined && !(Number.isInteger(id) && (id as number) > 0))
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: managerRow } = await supabase
    .from("managers").select("user_id").eq("user_id", user.id).maybeSingle();

  const base = supabase.from("notifications").update({ is_cleared: true });
  const owned = managerRow
    ? base.or(`user_id.eq.${user.id},user_id.is.null`)
    : base.eq("user_id", user.id);
  const filtered = id !== undefined ? owned.eq("id", id as number) : owned;

  const { error } = await filtered;
  if (error) {
    console.error("[api/notifications DELETE]", error);
    return NextResponse.json({ error: "Failed to clear notifications" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
