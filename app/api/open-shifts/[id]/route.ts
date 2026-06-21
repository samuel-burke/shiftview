import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// PUT /api/open-shifts/[id] — a manager resolves an open shift.
//   { action: "approve", claimId } → assign the claimant: create a schedules
//        row, mark the shift filled, deny the other claims.
//   { action: "cancel" }           → withdraw the shift, deny pending claims.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const openShiftId = Number(idParam);
  if (!Number.isInteger(openShiftId) || openShiftId <= 0) {
    return NextResponse.json({ error: "Invalid open shift id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, claimId } = body;
  if (action !== "approve" && action !== "cancel") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'cancel'" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const { data: shift, error: shiftError } = await supabase
    .from("open_shifts")
    .select("id, date, start_minutes, end_minutes, status")
    .eq("org_id", orgId!)
    .eq("id", openShiftId)
    .maybeSingle();

  if (shiftError) {
    console.error("[api/open-shifts/[id]]", shiftError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!shift)
    return NextResponse.json({ error: "Open shift not found" }, { status: 404 });
  if (shift.status !== "open")
    return NextResponse.json({ error: "Open shift is already resolved" }, { status: 409 });

  // ── Cancel ──────────────────────────────────────────────────────────────
  if (action === "cancel") {
    const { error: cancelError } = await supabase
      .from("open_shifts")
      .update({ status: "cancelled" })
      .eq("org_id", orgId!)
      .eq("id", openShiftId);
    if (cancelError) {
      console.error("[api/open-shifts/[id]]", cancelError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    await supabase
      .from("open_shift_claims")
      .update({ status: "denied" })
      .eq("org_id", orgId!)
      .eq("open_shift_id", openShiftId)
      .eq("status", "pending");

    writeAuditLog({
      action:       "open_shift.cancel",
      orgId:        orgId!,
      actorId:      user!.id,
      resourceType: "open_shift",
      resourceId:   String(openShiftId),
      before:       { status: "open" },
      after:        { status: "cancelled" },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  }

  // ── Approve ─────────────────────────────────────────────────────────────
  if (!Number.isInteger(claimId) || claimId <= 0) {
    return NextResponse.json(
      { error: "claimId is required to approve" },
      { status: 400 }
    );
  }

  const { data: claim, error: claimError } = await supabase
    .from("open_shift_claims")
    .select("id, open_shift_id, employee_id, status")
    .eq("org_id", orgId!)
    .eq("id", claimId)
    .maybeSingle();

  if (claimError) {
    console.error("[api/open-shifts/[id]]", claimError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!claim || claim.open_shift_id !== openShiftId)
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });

  const employeeId = claim.employee_id;

  // Create the real schedule row for the claimant.
  const { error: scheduleError } = await supabase.from("schedules").insert(
    withOrg(orgId!, {
      employee_id: employeeId,
      date: shift.date,
      start_minutes: shift.start_minutes,
      end_minutes: shift.end_minutes,
    })
  );
  if (scheduleError) {
    console.error("[api/open-shifts/[id]]", scheduleError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Mark the open shift filled.
  const { error: fillError } = await supabase
    .from("open_shifts")
    .update({ status: "filled", filled_by: employeeId, filled_at: new Date().toISOString() })
    .eq("org_id", orgId!)
    .eq("id", openShiftId);
  if (fillError) {
    console.error("[api/open-shifts/[id]]", fillError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Approve the winning claim, deny the rest.
  await supabase
    .from("open_shift_claims")
    .update({ status: "approved" })
    .eq("org_id", orgId!)
    .eq("id", claimId);
  await supabase
    .from("open_shift_claims")
    .update({ status: "denied" })
    .eq("org_id", orgId!)
    .eq("open_shift_id", openShiftId)
    .neq("id", claimId);

  // Notify the picked-up employee.
  const { data: emp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("org_id", orgId!)
    .eq("id", employeeId)
    .maybeSingle();

  if (emp?.user_id) {
    notify(supabase, {
      orgId: orgId!,
      userId: emp.user_id,
      type: "open_shift_filled",
      title: "Shift Assigned",
      body: `You picked up the open shift on ${shift.date}.`,
      data: { openShiftId, date: shift.date },
    }).catch(() => {});
  }

  writeAuditLog({
    action:       "open_shift.approve",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "open_shift",
    resourceId:   String(openShiftId),
    before:       { status: "open" },
    after:        { status: "filled", employeeId, claimId },
    metadata:     { employeeName: emp?.name ?? null, date: shift.date },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
