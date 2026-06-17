import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { notifyManagers } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { isEmployeeEligible } from "@/lib/open-shifts";

export const dynamic = "force-dynamic";

// POST /api/open-shifts/[id]/claim — an employee claims an open shift.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const openShiftId = Number(idParam);
  if (!Number.isInteger(openShiftId) || openShiftId <= 0) {
    return NextResponse.json({ error: "Invalid open shift id" }, { status: 400 });
  }

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId } = ctx!;
  if (!employeeId)
    return NextResponse.json({ error: "No employee record found" }, { status: 403 });

  // The open shift must exist in this org and still be open.
  const { data: shift, error: shiftError } = await supabase
    .from("open_shifts")
    .select("id, date, start_minutes, end_minutes, status")
    .eq("org_id", orgId)
    .eq("id", openShiftId)
    .maybeSingle();

  if (shiftError) {
    console.error("[api/open-shifts/[id]/claim]", shiftError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!shift)
    return NextResponse.json({ error: "Open shift not found" }, { status: 404 });
  if (shift.status !== "open")
    return NextResponse.json({ error: "This shift is no longer open" }, { status: 409 });

  // Eligibility — not already scheduled, on approved time off, or called out.
  const [{ data: schedules }, { data: timeOff }, { data: callouts }, { data: emp }] =
    await Promise.all([
      supabase
        .from("schedules")
        .select("date, start_minutes, end_minutes")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .eq("date", shift.date),
      supabase
        .from("time_off_requests")
        .select("date, status")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .eq("date", shift.date),
      supabase
        .from("callouts")
        .select("date")
        .eq("org_id", orgId)
        .eq("employee_id", employeeId)
        .eq("date", shift.date),
      supabase
        .from("employees")
        .select("id, name")
        .eq("org_id", orgId)
        .eq("id", employeeId)
        .maybeSingle(),
    ]);

  const eligibility = isEmployeeEligible(
    { date: shift.date, startMinutes: shift.start_minutes, endMinutes: shift.end_minutes },
    {
      schedules: (schedules ?? []).map((s) => ({
        date: s.date,
        startMinutes: s.start_minutes,
        endMinutes: s.end_minutes,
      })),
      timeOff: (timeOff ?? []).map((t) => ({ date: t.date, status: t.status })),
      callouts: (callouts ?? []).map((c) => ({ date: c.date })),
    }
  );
  if (!eligibility.eligible)
    return NextResponse.json({ error: eligibility.reason }, { status: 409 });

  // Upsert so re-claiming after a denial re-opens the claim as pending.
  const { data: claim, error: claimError } = await supabase
    .from("open_shift_claims")
    .upsert(
      withOrg(orgId, {
        open_shift_id: openShiftId,
        employee_id: employeeId,
        status: "pending",
      }),
      { onConflict: "org_id,open_shift_id,employee_id" }
    )
    .select("id")
    .single();

  if (claimError) {
    console.error("[api/open-shifts/[id]/claim]", claimError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  notifyManagers(
    supabase,
    orgId,
    "open_shift_available",
    "Shift Claimed",
    `${emp?.name ?? "An employee"} wants to pick up the open shift on ${shift.date}.`,
    { openShiftId, claimId: claim.id, employeeId }
  ).catch(() => {});

  writeAuditLog({
    action:       "open_shift.claim",
    orgId,
    actorId:      user.id,
    resourceType: "open_shift",
    resourceId:   String(openShiftId),
    after:        { claimId: claim.id, employeeId, status: "pending" },
    metadata:     { employeeName: emp?.name ?? null, date: shift.date },
  }).catch(() => {});

  return NextResponse.json({ id: claim.id, ok: true }, { status: 201 });
}
