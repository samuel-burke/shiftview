import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;

  if (!isManager) {
    // Employee sees only their own requests (as requester or target)
    if (!employeeId) return NextResponse.json([]);

    const { data, error: fetchError } = await supabase
      .from("shift_swaps")
      .select(`
        id,
        status,
        created_at,
        requester_id,
        target_id,
        schedule_a_id,
        schedule_b_id,
        requester:employees!shift_swaps_requester_id_fkey(id, name),
        target:employees!shift_swaps_target_id_fkey(id, name),
        schedule_a:schedules!shift_swaps_schedule_a_id_fkey(id, date, start_minutes, end_minutes, employee_id),
        schedule_b:schedules!shift_swaps_schedule_b_id_fkey(id, date, start_minutes, end_minutes, employee_id)
      `)
      .eq("org_id", orgId)
      .eq("status", "pending")
      .or(`requester_id.eq.${employeeId},target_id.eq.${employeeId}`)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("[api/swaps]", fetchError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  }

  // Manager sees all pending swaps for the org
  const { data, error: fetchError } = await supabase
    .from("shift_swaps")
    .select(`
      id,
      status,
      created_at,
      requester_id,
      target_id,
      schedule_a_id,
      schedule_b_id,
      requester:employees!shift_swaps_requester_id_fkey(id, name),
      target:employees!shift_swaps_target_id_fkey(id, name),
      schedule_a:schedules!shift_swaps_schedule_a_id_fkey(id, date, start_minutes, end_minutes, employee_id),
      schedule_b:schedules!shift_swaps_schedule_b_id_fkey(id, date, start_minutes, end_minutes, employee_id)
    `)
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (fetchError) {
    console.error("[api/swaps]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { scheduleAId, scheduleBId } = body;

  if (scheduleAId == null || scheduleBId == null) {
    return NextResponse.json(
      { error: "scheduleAId and scheduleBId are required" },
      { status: 400 }
    );
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

  // Fetch the requester's employee record for name
  const { data: requesterEmployee } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (!requesterEmployee)
    return NextResponse.json({ error: "No employee record found" }, { status: 403 });

  // Fetch both schedules — must belong to this org
  const [{ data: scheduleA, error: errA }, { data: scheduleB, error: errB }] = await Promise.all([
    supabase.from("schedules").select("id, employee_id, date").eq("org_id", orgId).eq("id", scheduleAId).maybeSingle(),
    supabase.from("schedules").select("id, employee_id, date").eq("org_id", orgId).eq("id", scheduleBId).maybeSingle(),
  ]);

  if (errA || !scheduleA) {
    return NextResponse.json({ error: "Schedule A not found" }, { status: 400 });
  }
  if (errB || !scheduleB) {
    return NextResponse.json({ error: "Schedule B not found" }, { status: 400 });
  }

  if (scheduleA.employee_id === scheduleB.employee_id) {
    return NextResponse.json(
      { error: "Cannot swap shifts with yourself" },
      { status: 400 }
    );
  }

  // The requester must own schedule A
  if (scheduleA.employee_id !== requesterEmployee.id) {
    return NextResponse.json({ error: "You can only request swaps for your own shifts" }, { status: 403 });
  }

  // Derive target from schedule B
  const targetId = scheduleB.employee_id;

  const { data: targetEmployee } = await supabase
    .from("employees")
    .select("name")
    .eq("org_id", orgId)
    .eq("id", targetId)
    .maybeSingle();

  const { data: inserted, error: insertError } = await supabase
    .from("shift_swaps")
    .insert(withOrg(orgId, {
      requester_id:  requesterEmployee.id,
      target_id:     targetId,
      schedule_a_id: scheduleAId,
      schedule_b_id: scheduleBId,
    }))
    .select("id")
    .maybeSingle();

  if (insertError) {
    console.error("[api/swaps]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "swap.request",
    orgId,
    actorId:      user.id,
    resourceType: "shift_swap",
    resourceId:   inserted?.id != null ? String(inserted.id) : null,
    after: {
      requesterId:  requesterEmployee.id,
      targetId,
      scheduleAId,
      scheduleBId,
    },
    metadata: {
      requesterName:  requesterEmployee.name,
      targetName:     targetEmployee?.name ?? null,
      scheduleADate:  scheduleA.date,
      scheduleBDate:  scheduleB.date,
    },
  }).catch(() => {});

  return NextResponse.json({ id: inserted?.id, ok: true });
}
