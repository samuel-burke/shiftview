import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getOrgContext } from "@/lib/org-context";
import { feedPath, hashFeedToken, newFeedToken } from "@/lib/calendar-feed";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// The signed-in employee's calendar subscription.
//
// GET    → { active } — whether a feed URL exists (the URL itself can't be
//          shown again: only its hash is stored).
// POST   → { url } — a new feed URL, replacing any earlier one.
// DELETE → turns the feed off; the old URL stops working.
//
// calendar_feeds is service-role only, so these use the admin client after
// resolving the caller's own employee record; nobody can touch another
// person's feed.

async function caller(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (error) return { error: NextResponse.json({ error }, { status: 403 }) };
  if (ctx!.employeeId == null)
    return { error: NextResponse.json({ error: "Only team members with a schedule have a calendar" }, { status: 403 }) };
  if (ctx!.isDemo)
    return { error: NextResponse.json({ error: "Calendar subscriptions aren't available in the demo" }, { status: 403 }) };
  return { ctx: ctx!, error: null };
}

export async function GET(request: Request) {
  const { ctx, error } = await caller(request);
  if (error) return error;
  const admin = createAdminClient();
  const { data, error: dbError } = await admin
    .from("calendar_feeds")
    .select("created_at")
    .eq("org_id", ctx.orgId)
    .eq("employee_id", ctx.employeeId)
    .maybeSingle();
  if (dbError) {
    console.error("[api/my-schedule/calendar/feed]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ active: !!data, createdAt: data?.created_at ?? null });
}

export async function POST(request: Request) {
  const { ctx, error } = await caller(request);
  if (error) return error;
  const token = newFeedToken();
  const admin = createAdminClient();
  const { error: dbError } = await admin
    .from("calendar_feeds")
    .upsert(
      { org_id: ctx.orgId, employee_id: ctx.employeeId, token_hash: hashFeedToken(token), created_at: new Date().toISOString() },
      { onConflict: "org_id,employee_id" }
    );
  if (dbError) {
    console.error("[api/my-schedule/calendar/feed]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  writeAuditLog({
    action: "calendar_feed.create",
    orgId: ctx.orgId,
    actorId: ctx.user.id,
    resourceType: "calendar_feed",
    resourceId: String(ctx.employeeId),
  }).catch(() => {});
  const origin = new URL(request.url).origin;
  return NextResponse.json({ url: `${origin}${feedPath(token)}` }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { ctx, error } = await caller(request);
  if (error) return error;
  const admin = createAdminClient();
  const { error: dbError } = await admin
    .from("calendar_feeds")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("employee_id", ctx.employeeId);
  if (dbError) {
    console.error("[api/my-schedule/calendar/feed]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  writeAuditLog({
    action: "calendar_feed.delete",
    orgId: ctx.orgId,
    actorId: ctx.user.id,
    resourceType: "calendar_feed",
    resourceId: String(ctx.employeeId),
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
