import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { validateEmployeeNote } from "@/lib/employee-note";

export const dynamic = "force-dynamic";

// GET /api/employee-notes?employeeId= (manager-only) — private notes about an
// employee, newest first, with author names. RLS (is_org_manager) is the
// backstop; requireManager gates the route.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId") ? Number(searchParams.get("employeeId")) : null;
  if (!Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data, error } = await supabase
    .from("employee_notes")
    .select("id, employee_id, author_id, body, created_at")
    .eq("org_id", orgId!)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/employee-notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const authorIds = [...new Set((data ?? []).map((n) => n.author_id).filter(Boolean))];
  const nameByUser = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: authors } = await supabase
      .from("employees")
      .select("user_id, name")
      .eq("org_id", orgId!)
      .in("user_id", authorIds);
    for (const a of authors ?? []) if (a.user_id) nameByUser.set(a.user_id, a.name);
  }

  return NextResponse.json({
    notes: (data ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author_id ? nameByUser.get(n.author_id) ?? "A manager" : "A manager",
      createdAt: n.created_at,
    })),
  });
}

// POST /api/employee-notes { employeeId, body } (manager-only) — add a note.
export async function POST(request: Request) {
  const reqBody = await request.json().catch(() => ({}));
  if (!Number.isInteger(reqBody.employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  const check = validateEmployeeNote(reqBody.body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", reqBody.employeeId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("employee_notes")
    .insert(withOrg(orgId!, { employee_id: reqBody.employeeId, author_id: user!.id, body: check.value }))
    .select("id")
    .single();

  if (error) {
    console.error("[api/employee-notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action: "employee_note.create", orgId: orgId!, actorId: user!.id,
    resourceType: "employee_note", resourceId: String(data.id),
    metadata: { employeeId: reqBody.employeeId, employeeName: emp.name },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}

// DELETE /api/employee-notes { id } (manager-only) — remove a note.
export async function DELETE(request: Request) {
  const reqBody = await request.json().catch(() => ({}));
  if (!Number.isInteger(reqBody.id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("employee_notes")
    .select("id")
    .eq("org_id", orgId!)
    .eq("id", reqBody.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const { error } = await supabase
    .from("employee_notes")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", reqBody.id);

  if (error) {
    console.error("[api/employee-notes]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action: "employee_note.delete", orgId: orgId!, actorId: user!.id,
    resourceType: "employee_note", resourceId: String(reqBody.id),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
