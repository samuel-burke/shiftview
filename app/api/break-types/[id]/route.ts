import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { parseBreakMinMinutes, parseBreakTypeName } from "@/lib/break-rules";

export const dynamic = "force-dynamic";

// PATCH /api/break-types/[id] { name?, paid?, minMinutes?, archived? } — a
// manager changes or archives a type. Breaks already taken keep the paid flag
// they were taken with (migration 0065), so a change applies to new breaks.
// Types are never deleted: punches name them.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = parseBreakTypeName(body.name);
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
    patch.name = name.name;
  }
  if (body.paid !== undefined) {
    if (typeof body.paid !== "boolean") return NextResponse.json({ error: "paid must be a boolean" }, { status: 400 });
    patch.paid = body.paid;
  }
  if (body.minMinutes !== undefined) {
    const min = parseBreakMinMinutes(body.minMinutes);
    if (!min.ok) return NextResponse.json({ error: min.error }, { status: 400 });
    patch.min_minutes = min.value;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data, error } = await supabase
    .from("break_types")
    .update(patch)
    .eq("org_id", orgId!)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ error: "A break type with that name already exists" }, { status: 409 });
    console.error("[api/break-types/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Break type not found" }, { status: 404 });

  writeAuditLog({
    action:       "break_type.update",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "break_type",
    resourceId:   String(id),
    after:        patch,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
