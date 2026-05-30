import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Check if manager
  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let query = supabase
    .from("shift_swaps")
    .select(
      `id, status, created_at,
       requester_id, target_id, schedule_a_id, schedule_b_id,
       requester:employees!shift_swaps_requester_id_fkey(id, name),
       target:employees!shift_swaps_target_id_fkey(id, name),
       schedule_a:schedules!shift_swaps_schedule_a_id_fkey(id, date, start_minutes, end_minutes, employee_id),
       schedule_b:schedules!shift_swaps_schedule_b_id_fkey(id, date, start_minutes, end_minutes, employee_id)`
    )
    .eq("status", "pending");

  if (!managerRow) {
    // Employee: look up their employee row
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!emp) return NextResponse.json([]);

    query = (query as any).or(`requester_id.eq.${emp.id},target_id.eq.${emp.id}`);
  }

  const { data, error } = await (query as any).order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { scheduleAId, scheduleBId } = body ?? {};

  if (scheduleAId == null || scheduleBId == null)
    return NextResponse.json({ error: "scheduleAId and scheduleBId required" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Look up the requester's employee row
  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp) return NextResponse.json({ error: "Employee record not found" }, { status: 403 });

  // Fetch both schedules
  const { data: scheduleA } = await supabase
    .from("schedules")
    .select("id, employee_id")
    .eq("id", scheduleAId)
    .maybeSingle();

  const { data: scheduleB } = await supabase
    .from("schedules")
    .select("id, employee_id")
    .eq("id", scheduleBId)
    .maybeSingle();

  if (!scheduleA || !scheduleB)
    return NextResponse.json({ error: "One or both schedules not found" }, { status: 400 });

  if (scheduleA.employee_id !== emp.id) {
    return NextResponse.json({ error: "You can only request swaps for your own shifts" }, { status: 403 });
  }

  if (scheduleA.employee_id === scheduleB.employee_id)
    return NextResponse.json({ error: "Cannot swap with yourself" }, { status: 400 });

  const requesterId = emp.id;
  const targetId = scheduleB.employee_id;

  const { data: inserted, error } = await supabase
    .from("shift_swaps")
    .insert({
      requester_id: requesterId,
      target_id: targetId,
      schedule_a_id: scheduleAId,
      schedule_b_id: scheduleBId,
    })
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: inserted?.id, ok: true });
}
