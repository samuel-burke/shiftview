import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { DEFAULT_BREAK_TYPE, parseBreakMinMinutes, parseBreakTypeName } from "@/lib/break-rules";
import { loadBreakTypes } from "@/lib/break-types-server";

export const dynamic = "force-dynamic";

// GET /api/break-types — the org's break types (any member), active ones by
// default; ?all=1 adds archived ones for managers. An empty list means the
// store uses the one implicit unpaid "Break" (lib/break-rules.ts).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { types, error: dbError } = await loadBreakTypes(supabase, ctx!.orgId);
  if (dbError) {
    console.error("[api/break-types]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const all = new URL(request.url).searchParams.get("all") === "1" && ctx!.isManager;
  return NextResponse.json({ breakTypes: all ? types : types.filter((t) => !t.archived) });
}

// POST /api/break-types { name, paid, minMinutes? } — a manager adds a type.
// The first type a store adds comes after the implicit unpaid "Break", which
// is saved as a real type first so the clock keeps offering it.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const name = parseBreakTypeName(body.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
  if (typeof body.paid !== "boolean")
    return NextResponse.json({ error: "paid must be a boolean" }, { status: 400 });
  const min = parseBreakMinMinutes(body.minMinutes ?? null);
  if (!min.ok) return NextResponse.json({ error: min.error }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { types, error: loadError } = await loadBreakTypes(supabase, orgId!);
  if (loadError) {
    console.error("[api/break-types]", loadError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const active = types.filter((t) => !t.archived);
  if (active.some((t) => t.name.toLowerCase() === name.name.toLowerCase()))
    return NextResponse.json({ error: "A break type with that name already exists" }, { status: 409 });

  const nextOrder = Math.max(0, ...types.map((t) => t.sortOrder + 1));
  const rows = [];
  if (active.length === 0 && name.name.toLowerCase() !== DEFAULT_BREAK_TYPE.name.toLowerCase())
    rows.push(withOrg(orgId!, { name: DEFAULT_BREAK_TYPE.name, paid: false, min_minutes: null, sort_order: nextOrder }));
  rows.push(withOrg(orgId!, { name: name.name, paid: body.paid, min_minutes: min.value, sort_order: nextOrder + rows.length }));

  const { data, error } = await supabase.from("break_types").insert(rows).select("id");
  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ error: "A break type with that name already exists" }, { status: 409 });
    console.error("[api/break-types]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const ids = (data ?? []) as { id: number }[];
  const id = ids[ids.length - 1]?.id ?? null;

  writeAuditLog({
    action:       "break_type.create",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "break_type",
    resourceId:   id != null ? String(id) : null,
    after:        { name: name.name, paid: body.paid, minMinutes: min.value, addedDefault: rows.length > 1 },
  }).catch(() => {});

  return NextResponse.json({ id, ok: true }, { status: 201 });
}
