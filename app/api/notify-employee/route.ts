import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { employeeId, message } = body;

  if (!employeeId || !message?.trim())
    return NextResponse.json({ error: "employeeId and message required" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: emp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("org_id", orgId!)
    .eq("id", employeeId)
    .maybeSingle();

  if (!emp?.user_id)
    return NextResponse.json({ error: "Employee not found or has no account" }, { status: 404 });

  await notify(supabase, {
    orgId: orgId!,
    userId: emp.user_id,
    type: "message",
    title: "New Message",
    body: message.trim(),
    data: { employeeId },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
