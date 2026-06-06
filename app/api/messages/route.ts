import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { notify } from "@/lib/notify";
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json([]);

  const convId = conversationId(user.id, withUserId);

  const { data, error } = await supabase
    .from("messages")
    .select("id, from_user_id, to_user_id, body, read, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[api/messages GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const decrypted = (data ?? []).map((msg: { id: number; from_user_id: string; to_user_id: string; body: string; read: boolean; created_at: string }) => {
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (user.id === toUserId)
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });

  // Resolve sender's display name from employees table, fall back to email prefix
  const { data: emp } = await supabase
    .from("employees")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle();
  const senderName = emp?.name ?? user.email?.split("@")[0] ?? "Someone";

  const convId = conversationId(user.id, toUserId);
  const trimmed = msgBody.trim();

  let encryptedBody: string;
  try {
    encryptedBody = encrypt(trimmed);
  } catch (err) {
    console.error("[api/messages POST] encryption failed:", err);
    return NextResponse.json({ error: "Message encryption is not configured" }, { status: 500 });
  }

  const { error: insertError } = await supabase.from("messages").insert({
    conversation_id: convId,
    from_user_id: user.id,
    to_user_id: toUserId,
    body: encryptedBody,
  });

  if (insertError) {
    console.error("[api/messages POST]", insertError);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  // Skip notifications for chess moves
  let isChessMove = false;
  try { isChessMove = JSON.parse(trimmed)._chess === true; } catch {}

  if (!isChessMove) {
    await notify(supabase, {
      userId: toUserId,
      type: "message",
      title: senderName,
      body: trimmed,
      data: { fromUserId: user.id, fromName: senderName },
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const convId = conversationId(user.id, withUserId);

  const { error } = await supabase
    .from("messages")
    .update({ read: true })
    .eq("conversation_id", convId)
    .eq("to_user_id", user.id)
    .eq("read", false);

  if (error) {
    console.error("[api/messages PATCH]", error);
    return NextResponse.json({ error: "Failed to mark read" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
