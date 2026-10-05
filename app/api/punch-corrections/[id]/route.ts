import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { checkManualPunchAgainstHistory, type PunchKind } from "@/lib/manual-punch-rules";
import { dateKeyInTz, formatDateKey, formatTimeInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";

export const dynamic = "force-dynamic";

// PUT /api/punch-corrections/[id] — manager approves or denies an employee's
// punch correction. Body: { status: "approved" | "denied", reviewNote? }
// Approval re-checks the request against the employee's current punches (they
// may have changed since it was filed) and only then creates the punch.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const { status, reviewNote } = body as { status?: string; reviewNote?: unknown };
  if (status !== "approved" && status !== "denied")
    return NextResponse.json({ error: 'status must be "approved" or "denied"' }, { status: 400 });
  const trimmedReviewNote = typeof reviewNote === "string" && reviewNote.trim() ? reviewNote.trim() : null;

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: correction } = await supabase
    .from("punch_corrections")
    .select("id, employee_id, punch_type, punched_at, note, status")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();
  if (!correction)
    return NextResponse.json({ error: "Correction not found" }, { status: 404 });
  if (correction.status !== "pending")
    return NextResponse.json({ error: `This request was already ${correction.status}` }, { status: 409 });

  if (status === "approved") {
    const ruleError = await checkManualPunchAgainstHistory(
      supabase, orgId!, correction.employee_id, correction.punch_type as PunchKind, correction.punched_at
    );
    if (ruleError)
      return NextResponse.json(
        { error: `Can't approve: the employee's punches have changed since this was requested. ${ruleError}` },
        { status: 409 }
      );
  }

  // Claim the request first (only while still pending) so two managers acting
  // at once can't both approve it and create a duplicate punch.
  const reviewedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("punch_corrections")
    .update({ status, reviewed_by: user!.id, reviewed_at: reviewedAt, review_note: trimmedReviewNote })
    .eq("org_id", orgId!)
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("[api/punch-corrections/[id]]", claimError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!claimed)
    return NextResponse.json({ error: "This request was already reviewed" }, { status: 409 });

  let punchId: number | null = null;
  if (status === "approved") {
    const { data: punch, error: insertError } = await supabase
      .from("punch_records")
      .insert(withOrg(orgId!, {
        employee_id: correction.employee_id,
        punch_type:  correction.punch_type,
        punched_at:  correction.punched_at,
        is_manual:   true,
        note:        correction.note,
      }))
      .select("id")
      .single();
    if (insertError || !punch) {
      console.error("[api/punch-corrections/[id]]", insertError);
      // Put the request back so it can be retried.
      await supabase
        .from("punch_corrections")
        .update({ status: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
        .eq("org_id", orgId!)
        .eq("id", id);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    punchId = punch.id;
    await supabase
      .from("punch_corrections")
      .update({ punch_id: punchId })
      .eq("org_id", orgId!)
      .eq("id", id);
  }

  const { data: emp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("org_id", orgId!)
    .eq("id", correction.employee_id)
    .maybeSingle();

  if (emp?.user_id) {
    const tz = await getOrgTimezone(supabase, orgId!);
    const when = `${formatTimeInTz(correction.punched_at, tz)} on ${formatDateKey(
      dateKeyInTz(correction.punched_at, tz), { weekday: "short", month: "short", day: "numeric" }
    )}`;
    const what = `${correction.punch_type.replace("_", " ")} at ${when}`;
    notify(supabase, {
      orgId: orgId!,
      userId: emp.user_id,
      type: status === "approved" ? "punch_correction_approved" : "punch_correction_denied",
      title: status === "approved" ? "Punch Correction Approved" : "Punch Correction Denied",
      body: status === "approved"
        ? `Your ${what} was approved.`
        : `Your ${what} was denied.${trimmedReviewNote ? ` ${trimmedReviewNote}` : ""}`,
      data: { correctionId: id },
    }).catch(() => {});
  }

  writeAuditLog({
    action:       status === "approved" ? "punch.correction_approve" : "punch.correction_deny",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "punch_correction",
    resourceId:   String(id),
    before:       { status: "pending" },
    after:        { status, punchId, reviewNote: trimmedReviewNote },
    metadata: {
      employeeId:   correction.employee_id,
      employeeName: emp?.name ?? null,
      punchType:    correction.punch_type,
      punchedAt:    correction.punched_at,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, status, punchId });
}
