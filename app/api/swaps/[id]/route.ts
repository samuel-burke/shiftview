import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const swapId = Number(idParam);
  if (!Number.isInteger(swapId) || swapId <= 0) {
    return NextResponse.json({ error: "Invalid swap id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const { status } = body;

  if (status !== "approved" && status !== "denied") {
    return NextResponse.json(
      { error: "status must be 'approved' or 'denied'" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  // Fetch the swap request
  const { data: swap, error: fetchError } = await supabase
    .from("shift_swaps")
    .select("id, status, schedule_a_id, schedule_b_id, requester_id, target_id")
    .eq("id", swapId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!swap) {
    return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
  }
  if (swap.status !== "pending") {
    return NextResponse.json({ error: "Swap is already resolved" }, { status: 409 });
  }

  if (status === "approved") {
    // Fetch both schedules to get their employee_ids
    const [{ data: scheduleA, error: errA }, { data: scheduleB, error: errB }] = await Promise.all([
      supabase.from("schedules").select("id, employee_id").eq("id", swap.schedule_a_id).maybeSingle(),
      supabase.from("schedules").select("id, employee_id").eq("id", swap.schedule_b_id).maybeSingle(),
    ]);

    if (errA || !scheduleA) {
      return NextResponse.json({ error: "Schedule A not found" }, { status: 400 });
    }
    if (errB || !scheduleB) {
      return NextResponse.json({ error: "Schedule B not found" }, { status: 400 });
    }

    // Atomically swap employee_ids: update A to B's employee, then B to A's employee
    const { error: updateAError } = await supabase
      .from("schedules")
      .update({ employee_id: scheduleB.employee_id })
      .eq("id", scheduleA.id);

    if (updateAError) {
      return NextResponse.json({ error: updateAError.message }, { status: 500 });
    }

    const { error: updateBError } = await supabase
      .from("schedules")
      .update({ employee_id: scheduleA.employee_id })
      .eq("id", scheduleB.id);

    if (updateBError) {
      // Attempt to revert the first update
      await supabase
        .from("schedules")
        .update({ employee_id: scheduleA.employee_id })
        .eq("id", scheduleA.id);
      return NextResponse.json({ error: updateBError.message }, { status: 500 });
    }
  }

  // Update swap status
  const { error: statusError } = await supabase
    .from("shift_swaps")
    .update({ status })
    .eq("id", swapId);

  if (statusError) {
    return NextResponse.json({ error: statusError.message }, { status: 500 });
  }

  // Notify the requester of the outcome and gather names for audit log
  const { data: requesterEmp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("id", swap.requester_id)
    .maybeSingle();

  const { data: targetEmp } = await supabase
    .from("employees")
    .select("name")
    .eq("id", swap.target_id)
    .maybeSingle();

  if (requesterEmp?.user_id) {
    notify(supabase, {
      userId: requesterEmp.user_id,
      type: status === "approved" ? "swap_approved" : "swap_denied",
      title: status === "approved" ? "Swap Request Approved" : "Swap Request Denied",
      body: status === "approved"
        ? "Your shift swap request has been approved."
        : "Your shift swap request was denied.",
      data: { swapId },
    }).catch(() => {});
  }

  writeAuditLog({
    action:       status === "approved" ? "swap.approve" : "swap.deny",
    actorId:      user?.id,
    resourceType: "shift_swap",
    resourceId:   String(swapId),
    before:       { status: "pending" },
    after:        { status },
    metadata: {
      requesterId:   swap.requester_id,
      requesterName: requesterEmp?.name ?? null,
      targetId:      swap.target_id,
      targetName:    targetEmp?.name ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
