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
    .order("created_at", { ascending: false })
    .limit(limit);

  if (managerRow) {
    // Managers see their own + broadcast (user_id = null)
    query = query.or(`user_id.eq.${user.id},user_id.is.null`);
  } else {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// PATCH /api/notifications — mark notification(s) as read
export async function PATCH(request: Request) {
  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: "ids array required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
