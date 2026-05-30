import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Check if user is a manager
  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const isManager = !!managerRow;

  let query = supabase
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
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (!isManager) {
    // Employee sees only their own requests (as requester or target)
    const { data: employeeRow } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!employeeRow) {
      return NextResponse.json([]);
    }

    // Re-query with filter
    const { data, error } = await supabase
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
      .eq("status", "pending")
      .or(`requester_id.eq.${employeeRow.id},target_id.eq.${employeeRow.id}`)
      .order("created_at", { ascending: false });

    if (error) {
    console.error("[api/swaps]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
    return NextResponse.json(data ?? []);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[api/swaps]", error);
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Look up the employee linked to the current user
  const { data: requesterEmployee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!requesterEmployee) {
    return NextResponse.json({ error: "No employee record found" }, { status: 403 });
  }

  // Fetch both schedules
  const [{ data: scheduleA, error: errA }, { data: scheduleB, error: errB }] = await Promise.all([
    supabase.from("schedules").select("id, employee_id").eq("id", scheduleAId).maybeSingle(),
    supabase.from("schedules").select("id, employee_id").eq("id", scheduleBId).maybeSingle(),
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

  const { data: inserted, error: insertError } = await supabase
    .from("shift_swaps")
    .insert({
      requester_id: requesterEmployee.id,
      target_id: targetId,
      schedule_a_id: scheduleAId,
      schedule_b_id: scheduleBId,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ id: inserted?.id, ok: true });
}
