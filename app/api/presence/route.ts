import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// POST /api/presence — record whether the calling device currently has the app
// in the foreground. The device is identified by its push subscription
// endpoint. The server uses this to suppress the duplicate OS push to a device
// whose app is already open (the in-app Realtime banner covers that case).
// See lib/notify.ts and migration 0012.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Heartbeats fire from every page, including signed-out ones; no-op quietly.
  if (!user) return NextResponse.json({ ok: false });

  // Beacons (navigator.sendBeacon / fetch keepalive) can arrive as text/plain
  // or with an empty body; parse leniently and default to a heartbeat.
  let endpoint: string | undefined;
  let active = true;
  try {
    const body = await request.json();
    if (typeof body?.endpoint === "string") endpoint = body.endpoint;
    if (typeof body?.active === "boolean") active = body.active;
  } catch {
    // non-JSON / empty body
  }

  // No push subscription on this device → nothing to suppress, nothing to record.
  if (!endpoint) return NextResponse.json({ ok: true });

  const { error } = await supabase.rpc("presence_set", {
    p_endpoint: endpoint,
    p_active: active,
  });
  if (error) {
    console.error("[api/presence]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
