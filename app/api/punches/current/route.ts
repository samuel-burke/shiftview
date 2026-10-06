import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { getOrgTimezone } from "@/lib/org-timezone";
import { loadCurrentShift } from "@/lib/current-shift-server";

export const dynamic = "force-dynamic";

// GET /api/punches/current
// The caller's current shift: its punches from clock-in onward, including a
// shift that started yesterday and is still open after midnight (within the
// overnight grace window — see lib/punch-sessions.ts). Drives the clock
// screen's state and the app-wide attendance ring.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, employeeId } = ctx!;
  if (!employeeId) return NextResponse.json({ carriedOver: false, punches: [] });

  const tz = await getOrgTimezone(supabase, orgId);
  const { shift, error: shiftError } = await loadCurrentShift(supabase, orgId, employeeId, tz);
  if (shiftError || !shift) {
    console.error("[api/punches/current]", shiftError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    carriedOver: shift.carriedOver,
    punches: shift.punches.map((r) => ({
      id:         r.id,
      employeeId: r.employee_id,
      scheduleId: r.schedule_id ?? null,
      punchType:  r.punch_type,
      punchedAt:  r.punched_at,
      lat:        r.lat ?? null,
      lng:        r.lng ?? null,
      isManual:   r.is_manual ?? false,
      note:       r.note ?? null,
    })),
  });
}
