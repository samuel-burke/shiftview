import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mapRow(r: Record<string, unknown>) {
  return {
    id:          r.id,
    employeeId:  r.employee_id,
    periodStart: r.period_start,
    periodEnd:   r.period_end,
    note:        (r.note as string | null) ?? null,
    approvedBy:  (r.approved_by as string | null) ?? null,
    approvedAt:  r.approved_at,
  };
}

// GET /api/timecard/approvals?employeeId=N
// Lists an employee's approved (locked) pay periods. Managers may query any
// employee in their org; a non-manager may only query their own record.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const employeeIdRaw = searchParams.get("employeeId");
  const employeeId = Number(employeeIdRaw);
  if (!employeeIdRaw || !Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId: selfEmployeeId } = ctx!;
  if (!isManager && employeeId !== selfEmployeeId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error: fetchError } = await supabase
    .from("timecard_approvals")
    .select("id, employee_id, period_start, period_end, note, approved_by, approved_at")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("period_start", { ascending: false });
  if (fetchError) {
    console.error("[api/timecard/approvals]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json((data ?? []).map(mapRow));
}

// POST /api/timecard/approvals — manager approves (locks) a pay period.
// Body: { employeeId, periodStart, periodEnd, note? }
export async function POST(request: Request) {
  const body = await request.json();
  const { employeeId, periodStart, periodEnd, note } = body;

  if (!Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!periodStart || !periodEnd || !DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd))
    return NextResponse.json({ error: "periodStart and periodEnd must be YYYY-MM-DD" }, { status: 400 });
  if (periodStart > periodEnd)
    return NextResponse.json({ error: "periodStart must not be after periodEnd" }, { status: 400 });
  const spanDays =
    (new Date(periodEnd + "T12:00:00Z").getTime() - new Date(periodStart + "T12:00:00Z").getTime()) / 86_400_000;
  if (spanDays > 366)
    return NextResponse.json({ error: "Period must not exceed 366 days" }, { status: 400 });
  if (note != null && typeof note !== "string")
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, user, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // Employee must belong to this org (tenant scoping).
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  // Reject any partial overlap with an existing approved period: a date must
  // never be covered by two approvals. existing.start <= newEnd AND
  // existing.end >= newStart is the standard inclusive-range intersection test.
  const { data: overlapping, error: overlapErr } = await supabase
    .from("timecard_approvals")
    .select("id, period_start, period_end")
    .eq("org_id", orgId!)
    .eq("employee_id", employeeId)
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart);
  if (overlapErr) {
    console.error("[api/timecard/approvals]", overlapErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (overlapping && overlapping.length > 0)
    return NextResponse.json(
      { error: "This period overlaps an already-approved period — reopen it first" },
      { status: 409 }
    );

  const { data: inserted, error: insertError } = await supabase
    .from("timecard_approvals")
    .insert(withOrg(orgId!, {
      employee_id:  employeeId,
      period_start: periodStart,
      period_end:   periodEnd,
      note:         (typeof note === "string" && note.trim()) ? note.trim() : null,
      approved_by:  user!.id,
    }))
    .select()
    .single();
  if (insertError) {
    console.error("[api/timecard/approvals]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "timecard.approved",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "timecard_approval",
    resourceId:   String(inserted.id),
    after:        { employeeId, periodStart, periodEnd },
    metadata:     { employeeId, employeeName: emp.name, periodStart, periodEnd },
  }).catch(() => {});

  return NextResponse.json(mapRow(inserted), { status: 201 });
}

// DELETE /api/timecard/approvals?id=N — manager reopens (unlocks) a period.
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get("id");
  const id = Number(idRaw);
  if (!idRaw || !Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, user, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // Load the row first (tenant-scoped) so the reopen can be audited and a
  // missing/foreign row returns 404 rather than a silent no-op delete.
  const { data: row } = await supabase
    .from("timecard_approvals")
    .select("id, employee_id, period_start, period_end")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();
  if (!row)
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });

  const { error: deleteError } = await supabase
    .from("timecard_approvals")
    .delete()
    .eq("org_id", orgId!)
    .eq("id", id);
  if (deleteError) {
    console.error("[api/timecard/approvals]", deleteError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "timecard.reopened",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "timecard_approval",
    resourceId:   String(id),
    before:       { employeeId: row.employee_id, periodStart: row.period_start, periodEnd: row.period_end },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
