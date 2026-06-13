import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// POST /api/presence — record whether the caller's app is currently in the
// foreground. The server uses this to suppress duplicate OS push notifications
// while the user is actively looking at the app (the in-app Realtime banner
// already covers that case). See lib/notify.ts and migration 0011.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Heartbeats fire from every page, including signed-out ones; no-op quietly.
  if (!user) return NextResponse.json({ ok: false });

  // Beacons (navigator.sendBeacon / fetch keepalive) can arrive as text/plain
  // or with an empty body; parse leniently and default to a heartbeat.
  let active = true;
  try {
    const body = await request.json();
    if (typeof body?.active === "boolean") active = body.active;
  } catch {
    // non-JSON / empty body — treat as an active heartbeat
  }

  const { error } = await supabase.rpc("presence_set", { p_active: active });
  if (error) {
    console.error("[api/presence]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
