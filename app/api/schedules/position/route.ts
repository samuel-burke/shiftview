import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// PUT /api/schedules/position { scheduleId, positionId|null }
// Assigns (or clears) the position on a scheduled shift. Kept separate from the
// main schedules route so the position model doesn't entangle the shift
// create/edit/validation flow.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { scheduleId, positionId } = body;

  if (!Number.isInteger(scheduleId))
    return NextResponse.json({ error: "scheduleId must be an integer" }, { status: 400 });
  if (positionId !== null && !Number.isInteger(positionId))
    return NextResponse.json({ error: "positionId must be an integer or null" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  // The shift must belong to this org.
  const { data: schedule } = await supabase
    .from("schedules")
    .select("id, employee_id")
    .eq("org_id", orgId!)
    .eq("id", scheduleId)
    .maybeSingle();
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // A non-null position must also belong to this org.
  if (positionId !== null) {
    const { data: position } = await supabase
      .from("positions")
      .select("id")
      .eq("org_id", orgId!)
      .eq("id", positionId)
      .maybeSingle();
    if (!position) return NextResponse.json({ error: "Position not found" }, { status: 400 });
  }

  const { error } = await supabase
    .from("schedules")
    .update({ position_id: positionId })
    .eq("org_id", orgId!)
    .eq("id", scheduleId);

  if (error) {
    console.error("[api/schedules/position]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "schedule.assign_position",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "schedule",
    resourceId:   String(scheduleId),
    after:        { positionId },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
