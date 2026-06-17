import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { validatePositionName } from "@/lib/positions";

export const dynamic = "force-dynamic";

// GET /api/positions — the org's positions (any member).
export async function GET(request?: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { data, error: dbError } = await supabase
    .from("positions")
    .select("id, name, color")
    .eq("org_id", ctx!.orgId)
    .order("name", { ascending: true });

  if (dbError) {
    console.error("[api/positions]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ positions: data ?? [] });
}

// POST /api/positions { name, color? } — manager creates a position.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const check = validatePositionName(body.name);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const color =
    typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data, error } = await supabase
    .from("positions")
    .insert(withOrg(orgId!, { name: check.value, color }))
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ error: "A position with that name already exists" }, { status: 409 });
    console.error("[api/positions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "position.create",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "position",
    resourceId:   String(data.id),
    after:        { name: check.value, color },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}

// DELETE /api/positions { id } — manager removes a position. Shifts that used it
// keep their slot (the FK is ON DELETE SET NULL).
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
    .from("positions")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  const { error } = await supabase
    .from("positions")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", id);

  if (error) {
    console.error("[api/positions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "position.delete",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "position",
    resourceId:   String(id),
    before:       { name: existing.name },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
