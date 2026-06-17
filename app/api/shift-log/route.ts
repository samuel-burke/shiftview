import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { validateShiftLogEntry } from "@/lib/shift-log";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/shift-log?date=YYYY-MM-DD — the day's handoff entries (any member),
// oldest first, annotated with author names.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId } = ctx!;

  const { data, error: dbError } = await supabase
    .from("shift_log_entries")
    .select("id, employee_id, body, created_at")
    .eq("org_id", orgId)
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (dbError) {
    console.error("[api/shift-log]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ids = [...new Set((data ?? []).map((e) => e.employee_id))];
  const nameById = new Map<number, string>();
  if (ids.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", ids);
    for (const e of emps ?? []) nameById.set(e.id, e.name);
  }

  return NextResponse.json({
    entries: (data ?? []).map((e) => ({
      id: e.id,
      employeeId: e.employee_id,
      authorName: nameById.get(e.employee_id) ?? "Unknown",
      body: e.body,
      createdAt: e.created_at,
    })),
  });
}

// POST /api/shift-log { date, body } — any member posts a handoff entry.
export async function POST(request: Request) {
  const reqBody = await request.json().catch(() => ({}));
  const { date, body } = reqBody;

  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  const check = validateShiftLogEntry(body);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId } = ctx!;
  if (!employeeId)
    return NextResponse.json({ error: "No employee record found" }, { status: 403 });

  const { data, error: insertError } = await supabase
    .from("shift_log_entries")
    .insert(withOrg(orgId, { employee_id: employeeId, date, body: check.value }))
    .select("id")
    .single();

  if (insertError) {
    console.error("[api/shift-log]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "shift_log.create",
    orgId,
    actorId:      user.id,
    resourceType: "shift_log_entry",
    resourceId:   String(data.id),
    after:        { date, employeeId },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}

// DELETE /api/shift-log { id } — the author or a manager removes an entry.
export async function DELETE(request: Request) {
  const reqBody = await request.json().catch(() => ({}));
  const { id } = reqBody;
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, isManager, employeeId } = ctx!;

  const { data: entry } = await supabase
    .from("shift_log_entries")
    .select("id, employee_id")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  // Only the author or a manager may delete.
  if (!isManager && entry.employee_id !== employeeId)
    return NextResponse.json({ error: "You can only delete your own entries" }, { status: 403 });

  const { error: delError } = await supabase
    .from("shift_log_entries")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);

  if (delError) {
    console.error("[api/shift-log]", delError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "shift_log.delete",
    orgId,
    actorId:      user.id,
    resourceType: "shift_log_entry",
    resourceId:   String(id),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
