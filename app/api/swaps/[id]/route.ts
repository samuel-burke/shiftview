import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// A swap moves through two gates, each driven by a different actor:
//   target employee:  pending  → accepted | declined
//   manager:          accepted → approved | denied
// Keeping these sets explicit lets one PUT serve both actors while making the
// "who may do what, and from which state" rules obvious.
const TARGET_ACTIONS = ["accepted", "declined"] as const;
const MANAGER_ACTIONS = ["approved", "denied"] as const;
type TargetAction = (typeof TARGET_ACTIONS)[number];
type ManagerAction = (typeof MANAGER_ACTIONS)[number];

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
  const { status } = body as { status?: string };
  const isTargetAction = (TARGET_ACTIONS as readonly string[]).includes(status ?? "");
  const isManagerAction = (MANAGER_ACTIONS as readonly string[]).includes(status ?? "");

  if (!isTargetAction && !isManagerAction) {
    return NextResponse.json(
      { error: "status must be 'accepted', 'declined', 'approved' or 'denied'" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { ctx, error: authError } = await getOrgContext(supabase, request);
  if (authError === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (authError)
    return NextResponse.json({ error: authError }, { status: 403 });

  const { orgId, isManager, employeeId, user } = ctx!;

  // Fetch the swap request — scoped to this org
  const { data: swap, error: fetchError } = await supabase
    .from("shift_swaps")
    .select("id, status, schedule_a_id, schedule_b_id, requester_id, target_id")
    .eq("org_id", orgId)
    .eq("id", swapId)
    .maybeSingle();

  if (fetchError) {
    console.error("[api/swaps/[id]]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!swap) {
    return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
  }

  // ── Target employee accepting / declining ─────────────────────────────────
  // Only the person being asked to give up their shift can answer, and only
  // while the request is still pending.
  if (isTargetAction) {
    if (employeeId == null || employeeId !== swap.target_id) {
      return NextResponse.json(
        { error: "Only the employee asked to swap can respond to this request" },
        { status: 403 }
      );
    }
    if (swap.status !== "pending") {
      return NextResponse.json(
        { error: "This swap is no longer awaiting your response" },
        { status: 409 }
      );
    }

    return respondAsTarget(supabase, {
      orgId: orgId!,
      swapId,
      status: status as TargetAction,
      requesterId: swap.requester_id,
      targetId: swap.target_id,
      actorId: user?.id,
    });
  }

  // ── Manager approving / denying ───────────────────────────────────────────
  if (!isManager) {
    return NextResponse.json({ error: "Manager access required" }, { status: 403 });
  }
  // The consent gate: a manager can't act until the target has accepted.
  if (swap.status === "pending") {
    return NextResponse.json(
      { error: "This swap is still awaiting the other employee's acceptance" },
      { status: 409 }
    );
  }
  if (swap.status !== "accepted") {
    return NextResponse.json({ error: "Swap is already resolved" }, { status: 409 });
  }

  return resolveAsManager(supabase, {
    orgId: orgId!,
    swapId,
    status: status as ManagerAction,
    requesterId: swap.requester_id,
    targetId: swap.target_id,
    actorId: user?.id,
  });
}

// ── Target acceptance / decline ──────────────────────────────────────────────
async function respondAsTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    orgId: string;
    swapId: number;
    status: TargetAction;
    requesterId: number;
    targetId: number;
    actorId?: string;
  }
) {
  const { orgId, swapId, status, requesterId, targetId, actorId } = args;

  const { error: statusError } = await supabase
    .from("shift_swaps")
    .update({ status })
    .eq("org_id", orgId)
    .eq("id", swapId);

  if (statusError) {
    console.error("[api/swaps/[id]]", statusError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Tell the requester how the target responded.
  const { data: requesterEmp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("org_id", orgId)
    .eq("id", requesterId)
    .maybeSingle();
  const { data: targetEmp } = await supabase
    .from("employees")
    .select("name")
    .eq("org_id", orgId)
    .eq("id", targetId)
    .maybeSingle();

  if (requesterEmp?.user_id) {
    const accepted = status === "accepted";
    notify(supabase, {
      orgId,
      userId: requesterEmp.user_id,
      type: accepted ? "swap_accepted" : "swap_declined",
      title: accepted ? "Swap Accepted" : "Swap Declined",
      body: accepted
        ? `${targetEmp?.name ?? "Your coworker"} accepted your swap — it's now awaiting manager approval.`
        : `${targetEmp?.name ?? "Your coworker"} declined your swap request.`,
      data: { swapId },
    }).catch(() => {});
  }

  writeAuditLog({
    action:       status === "accepted" ? "swap.accept" : "swap.decline",
    orgId,
    actorId,
    resourceType: "shift_swap",
    resourceId:   String(swapId),
    before:       { status: "pending" },
    after:        { status },
    metadata: {
      requesterId,
      requesterName: requesterEmp?.name ?? null,
      targetId,
      targetName:    targetEmp?.name ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

// ── Manager approval / denial (operates only on an 'accepted' swap) ──────────
async function resolveAsManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    orgId: string;
    swapId: number;
    status: ManagerAction;
    requesterId: number;
    targetId: number;
    actorId?: string;
  }
) {
  const { orgId, swapId, status, requesterId, targetId, actorId } = args;

  if (status === "approved") {
    // Exchange the two shifts and resolve the swap atomically (single
    // transaction, row-locked) so a crash or concurrent approval can't move one
    // shift without the other. The function re-checks manager + org + that the
    // swap is still 'accepted', returning a status string we map to a response.
    const { data: result, error: rpcError } = await supabase.rpc("approve_shift_swap", {
      p_org: orgId,
      p_swap_id: swapId,
    });

    if (rpcError) {
      console.error("[api/swaps/[id]]", rpcError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (result !== "approved") {
      // Lost a race between the pre-check above and the locked apply.
      if (result === "not_found")
        return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
      if (result === "schedule_missing")
        return NextResponse.json({ error: "Shift not found" }, { status: 400 });
      if (result === "forbidden")
        return NextResponse.json({ error: "Manager access required" }, { status: 403 });
      // pending / approved / denied / declined — no longer approvable.
      return NextResponse.json({ error: "Swap is already resolved" }, { status: 409 });
    }
  } else {
    // Denial never touches schedules — a single status update is already atomic.
    const { error: statusError } = await supabase
      .from("shift_swaps")
      .update({ status })
      .eq("org_id", orgId)
      .eq("id", swapId);

    if (statusError) {
      console.error("[api/swaps/[id]]", statusError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // Notify the requester of the outcome and gather names for audit log
  const { data: requesterEmp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("org_id", orgId)
    .eq("id", requesterId)
    .maybeSingle();

  const { data: targetEmp } = await supabase
    .from("employees")
    .select("name")
    .eq("org_id", orgId)
    .eq("id", targetId)
    .maybeSingle();

  if (requesterEmp?.user_id) {
    notify(supabase, {
      orgId,
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
    orgId,
    actorId,
    resourceType: "shift_swap",
    resourceId:   String(swapId),
    before:       { status: "accepted" },
    after:        { status },
    metadata: {
      requesterId,
      requesterName: requesterEmp?.name ?? null,
      targetId,
      targetName:    targetEmp?.name ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
