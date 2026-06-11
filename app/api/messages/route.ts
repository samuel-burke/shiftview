import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { notify, notifyChessMove } from "@/lib/notify";
import { encrypt, decrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

function conversationId(a: string, b: string): string {
  return [a, b].sort().join("_");
}

// GET /api/messages?with=<userId>&limit=50
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const withUserId = searchParams.get("with");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  if (!withUserId)
    return NextResponse.json({ error: "with param required" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, user, error } = await getOrgContext(supabase, request);

  // Not authenticated — keep existing unauthenticated behavior
  if (error === "Not authenticated") return NextResponse.json([]);
  if (error) return NextResponse.json({ error: "No organization membership" }, { status: 403 });

  const { orgId } = ctx!;

  // Verify that the counterpart user is in the same org (org-scoped employee lookup)
  const { data: counterpartEmp } = await supabase
    .from("employees")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", withUserId)
    .maybeSingle();

  // Also check if counterpart is a manager in this org
  const { data: counterpartMgr } = await supabase
    .from("managers")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("user_id", withUserId)
    .maybeSingle();

  if (!counterpartEmp && !counterpartMgr)
    return NextResponse.json({ error: "User not found in organization" }, { status: 403 });

  const convId = conversationId(user!.id, withUserId);

  const { data, error: dbError } = await supabase
    .from("messages")
    .select("id, from_user_id, to_user_id, body, read, created_at")
    .eq("org_id", orgId)
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (dbError) {
    console.error("[api/messages GET]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Reverse to chronological order — we fetch newest-first so the limit always
  // includes the most recent messages (critical when chess moves fill the window)
  const decrypted = (data ?? []).reverse().map((msg: { id: number; from_user_id: string; to_user_id: string; body: string; read: boolean; created_at: string }) => {
    try {
      return { ...msg, body: decrypt(msg.body) };
    } catch {
      // Return as-is if decryption fails (e.g. pre-encryption messages)
      return msg;
    }
  });

  return NextResponse.json(decrypted);
}

// POST /api/messages — send a message
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { toUserId, body: msgBody } = body;

  if (!toUserId || !msgBody?.trim())
    return NextResponse.json({ error: "toUserId and body required" }, { status: 400 });

  if (msgBody.trim().length > 2000)
    return NextResponse.json({ error: "Message too long" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, user, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });

  const { orgId } = ctx!;

  if (user!.id === toUserId)
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });

  // Resolve sender's display name from employees table (org-scoped), fall back to email prefix
  const { data: emp } = await supabase
    .from("employees")
    .select("name")
    .eq("org_id", orgId)
    .eq("user_id", user!.id)
    .maybeSingle();
  const senderName = emp?.name ?? user!.email?.split("@")[0] ?? "Someone";

  const convId = conversationId(user!.id, toUserId);
  const trimmed = msgBody.trim();

  let encryptedBody: string;
  try {
    encryptedBody = encrypt(trimmed);
  } catch (err) {
    console.error("[api/messages POST] encryption failed:", err);
    return NextResponse.json({ error: "Message encryption is not configured" }, { status: 500 });
  }

  const { error: insertError } = await supabase.from("messages").insert(
    withOrg(orgId, {
      conversation_id: convId,
      from_user_id: user!.id,
      to_user_id: toUserId,
      body: encryptedBody,
    })
  );

  if (insertError) {
    console.error("[api/messages POST]", insertError);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  let isChessMove = false;
  let chessStatus = "active";
  try {
    const parsedBody = JSON.parse(trimmed);
    if (parsedBody._chess === true) {
      isChessMove = true;
      chessStatus = typeof parsedBody.status === "string" ? parsedBody.status : "active";
    }
  } catch {}

  if (isChessMove) {
    await notifyChessMove(supabase, {
      toUserId,
      fromUserId: user!.id,
      fromName:   senderName,
      convId,
      chessStatus,
    }).catch(() => {});
  } else {
    await notify(supabase, {
      orgId,
      userId: toUserId,
      type: "message",
      title: senderName,
      body: trimmed,
      data: { fromUserId: user!.id, fromName: senderName },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

// PATCH /api/messages — mark all messages in a conversation as read
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { withUserId } = body;

  if (!withUserId)
    return NextResponse.json({ error: "withUserId required" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, user, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });

  const { orgId } = ctx!;

  const convId = conversationId(user!.id, withUserId);

  const { error: dbError } = await supabase
    .from("messages")
    .update({ read: true })
    .eq("org_id", orgId)
    .eq("conversation_id", convId)
    .eq("to_user_id", user!.id)
    .eq("read", false);

  if (dbError) {
    console.error("[api/messages PATCH]", dbError);
    return NextResponse.json({ error: "Failed to mark read" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
