import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { validateAnnouncement } from "@/lib/announcement";

export const dynamic = "force-dynamic";

const MAX_FEED = 100;

// GET /api/announcements — the org's announcements, newest first (any member).
export async function GET(request?: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { data, error: dbError } = await supabase
    .from("announcements")
    .select("id, title, body, created_at, created_by")
    .eq("org_id", ctx!.orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_FEED);

  if (dbError) {
    console.error("[api/announcements]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    announcements: (data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      createdAt: a.created_at,
      createdBy: a.created_by,
    })),
  });
}

// POST /api/announcements { title, body } — manager posts an announcement.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const check = validateAnnouncement(body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data, error } = await supabase
    .from("announcements")
    .insert(withOrg(orgId!, { title: check.value.title, body: check.value.body, created_by: user!.id }))
    .select("id")
    .single();

  if (error) {
    console.error("[api/announcements]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "announcement.create",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "announcement",
    resourceId:   String(data.id),
    after:        { title: check.value.title },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}

// DELETE /api/announcements { id } — manager removes an announcement.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data: existing } = await supabase
    .from("announcements")
    .select("id, title")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Announcement not found" }, { status: 404 });

  const { error } = await supabase
    .from("announcements")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", id);

  if (error) {
    console.error("[api/announcements]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "announcement.delete",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "announcement",
    resourceId:   String(id),
    before:       { title: existing.title },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
