import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const swapId = Number(id);

  if (!Number.isInteger(swapId) || isNaN(swapId))
    return NextResponse.json({ error: "Invalid swap id" }, { status: 400 });

  const body = await request.json();
  const { status } = body ?? {};

  if (status !== "approved" && status !== "denied")
    return NextResponse.json({ error: "status must be 'approved' or 'denied'" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  if (status === "denied") {
    const { error } = await supabase
      .from("shift_swaps")
      .update({ status: "denied" })
      .eq("id", swapId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // approved: swap employee_id on both schedules
  const { data: swap, error: fetchError } = await supabase
    .from("shift_swaps")
    .select("schedule_a_id, schedule_b_id")
    .eq("id", swapId)
    .maybeSingle();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!swap) return NextResponse.json({ error: "Swap not found" }, { status: 404 });

  // Fetch both schedules to get their current employee_ids
  const { data: scheduleA, error: errA } = await supabase
    .from("schedules")
    .select("id, employee_id")
    .eq("id", swap.schedule_a_id)
    .maybeSingle();

  const { data: scheduleB, error: errB } = await supabase
    .from("schedules")
    .select("id, employee_id")
    .eq("id", swap.schedule_b_id)
    .maybeSingle();

  if (errA || errB) return NextResponse.json({ error: "Failed to fetch schedules" }, { status: 500 });
  if (!scheduleA || !scheduleB) return NextResponse.json({ error: "Schedules not found" }, { status: 404 });

  // Swap: update scheduleA to have scheduleB's employee, and vice-versa
  const { error: updateA } = await supabase
    .from("schedules")
    .update({ employee_id: scheduleB.employee_id })
    .eq("id", scheduleA.id);

  if (updateA) return NextResponse.json({ error: updateA.message }, { status: 500 });

  const { error: updateB } = await supabase
    .from("schedules")
    .update({ employee_id: scheduleA.employee_id })
    .eq("id", scheduleB.id);

  if (updateB) {
    // Attempt revert of first update
    await supabase
      .from("schedules")
      .update({ employee_id: scheduleA.employee_id })
      .eq("id", scheduleA.id);
    return NextResponse.json({ error: updateB.message }, { status: 500 });
  }

  // Mark swap as approved
  const { error: updateSwap } = await supabase
    .from("shift_swaps")
    .update({ status: "approved" })
    .eq("id", swapId);

  if (updateSwap) return NextResponse.json({ error: updateSwap.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
