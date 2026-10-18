import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { isRequestLeaveType, isValidPaidHours } from "@/lib/pto";
import { decideTimeOff } from "@/lib/pto-server";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || isNaN(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const { status, leaveType, paidHours, allowNegative } = await request.json();
  if (status !== "approved" && status !== "denied")
    return NextResponse.json(
      { error: 'status must be "approved" or "denied"' },
      { status: 400 }
    );
  // The manager may set the request's type and paid hours as they decide,
  // and approve past the balance (allowNegative) once warned.
  if (leaveType !== undefined && !isRequestLeaveType(leaveType))
    return NextResponse.json({ error: "leaveType must be unpaid, pto or sick" }, { status: 400 });
  if (paidHours !== undefined && paidHours !== null && !isValidPaidHours(paidHours))
    return NextResponse.json({ error: "paidHours must be more than 0 and at most 24" }, { status: 400 });
  if (allowNegative !== undefined && typeof allowNegative !== "boolean")
    return NextResponse.json({ error: "allowNegative must be a boolean" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // Fetch the request before updating so we can notify the employee
  const { data: pto } = await supabase
    .from("time_off_requests")
    .select("employee_id, date")
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();

  // decide_time_off (0064) writes the PTO ledger and refuses an overdraw.
  const decided = await decideTimeOff(supabase, id, status, {
    leaveType,
    paidHours: paidHours ?? undefined,
    allowNegative,
  });
  if (decided.status === "insufficient")
    return NextResponse.json({
      error: decided.message
        ?? `Not enough ${decided.leaveType === "sick" ? "sick" : "PTO"} balance (${decided.balance} h for ${decided.hours} h)`,
      code: "insufficient_balance",
      leaveType: decided.leaveType,
      balance: decided.balance,
      hours: decided.hours,
    }, { status: 409 });
  if (decided.status === "not_found")
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (decided.status === "conflict")
    return NextResponse.json({ error: "This request was already decided or cancelled", current: decided.current ?? null }, { status: 409 });
  if (decided.status !== "ok")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  // Notify the employee of the decision
  let empName: string | null = null;
  if (pto?.employee_id) {
    const { data: emp } = await supabase
      .from("employees")
      .select("user_id, name")
      .eq("org_id", orgId!)
      .eq("id", pto.employee_id)
      .maybeSingle();
    empName = emp?.name ?? null;
    if (emp?.user_id) {
      notify({
        orgId: orgId!,
        userId: emp.user_id,
        type: status === "approved" ? "pto_approved" : "pto_denied",
        title: status === "approved" ? "Time Off Approved" : "Time Off Denied",
        body: status === "approved"
          ? `Your time-off request for ${pto.date} has been approved.`
          : `Your time-off request for ${pto.date} was denied.`,
        data: { ptoId: id, date: pto.date },
      }).catch(() => {});
    }
  }

  writeAuditLog({
    action:       status === "approved" ? "time_off.approve" : "time_off.deny",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "time_off_request",
    resourceId:   String(id),
    before:       { status: "pending" },
    after:        { status, leaveType: decided.leaveType ?? null, paidHours: decided.paidHours ?? null },
    metadata: {
      employeeId:   pto?.employee_id ?? null,
      employeeName: empName,
      date:         pto?.date ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, balance: decided.balance ?? null });
}
