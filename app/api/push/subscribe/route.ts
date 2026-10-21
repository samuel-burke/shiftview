import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";

export const dynamic = "force-dynamic";

// POST /api/push/subscribe — save a push subscription
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Anonymous demo visitors are deleted on every demo reset; their device
  // subscriptions would be orphaned, so don't accept them.
  if (user.is_anonymous)
    return NextResponse.json({ error: "Push notifications are not available in demo mode" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { endpoint, keys } = body;

  if (!endpoint || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string")
    return NextResponse.json({ error: "endpoint and keys (p256dh, auth) required" }, { status: 400 });
  // The server POSTs every notification to this URL: only a browser push
  // service, never an arbitrary host (lib/push-endpoint.ts).
  if (!isAllowedPushEndpoint(endpoint))
    return NextResponse.json({ error: "endpoint must be a browser push service URL" }, { status: 400 });

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: user.id, endpoint, p256dh: keys.p256dh, auth_key: keys.auth },
    { onConflict: "user_id,endpoint" }
  );

  if (error) {
    console.error("[api/push/subscribe]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE /api/push/subscribe — remove a push subscription
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { endpoint } = body;
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });

  await supabase.from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
