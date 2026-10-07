import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { validateShiftMinutes } from "@/app/api/schedules/validation";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { weekDates } from "@/lib/draft-metrics";
import { findShiftConflict, findShiftOverlap } from "@/lib/shift-conflicts-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// The live schedule wins. A draft can't go on a day the employee already has
// a published shift (publish would skip it and the change would be lost) or
// overlap a live overnight shift. Not overridable.
async function findLiveClash(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: number,
  date: string,
  startMinutes: number,
  endMinutes: number
): Promise<NextResponse | null> {
  const { data: live } = await supabase
    .from("schedules")
    .select("id")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("date", date)
    .limit(1);
  if (Array.isArray(live) && live.length > 0)
    return NextResponse.json({ error: "Already has a live shift that day. Change it in Live mode.", live: true }, { status: 409 });
  const overlap = await findShiftOverlap(supabase, "schedules", orgId, employeeId, date, startMinutes, endMinutes);
  return overlap ? NextResponse.json({ error: `${overlap} (live)`, live: true }, { status: 409 }) : null;
}

async function findConflict(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: number,
  date: string,
  startMinutes: number,
  endMinutes: number
): Promise<NextResponse | null> {
  const conflict = await findShiftConflict(supabase, orgId, employeeId, date, startMinutes, endMinutes);
  return conflict ? NextResponse.json(conflict, { status: 409 }) : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get("weekStart");

  if (!weekStart) return NextResponse.json({ error: "weekStart param required" }, { status: 400 });
  if (!DATE_RE.test(weekStart)) return NextResponse.json({ error: "weekStart must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const dates = weekDates(weekStart);
  const { data, error } = await supabase
    .from("draft_schedules")
    .select("*")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6])
    .order("start_minutes");

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const mapped = data.map((s) => ({
    id:           s.id,
    employeeId:   s.employee_id,
    date:         typeof s.date === "string" ? s.date.slice(0, 10) : s.date,
    startMinutes: s.start_minutes,
    endMinutes:   s.end_minutes,
    // The Auto-schedule run that created it (null if made by hand).
    generationRunId: s.generation_run_id ?? null,
  }));

  return NextResponse.json(mapped);
}

export async function POST(request: Request) {
  const { employeeId, date, startMinutes, endMinutes, override = false } = await request.json();

  if (employeeId == null || !date || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "employeeId, date, startMinutes, endMinutes required" }, { status: 400 });
  if (!DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("draft_schedules")
    .select("id")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("date", date)
    .maybeSingle();

  if (existing)
    return NextResponse.json({ error: "Employee already has a draft shift on this date" }, { status: 409 });

  const overlap = await findShiftOverlap(supabase, "draft_schedules", orgId!, employeeId, date, startMinutes, endMinutes);
  if (overlap) return NextResponse.json({ error: overlap }, { status: 409 });

  const liveClash = await findLiveClash(supabase, orgId!, employeeId, date, startMinutes, endMinutes);
  if (liveClash) return liveClash;

  if (!override) {
    const conflict = await findConflict(supabase, orgId!, employeeId, date, startMinutes, endMinutes);
    if (conflict) return conflict;
  }

  const { error } = await supabase
    .from("draft_schedules")
    .insert(withOrg(orgId!, { employee_id: employeeId, date, start_minutes: startMinutes, end_minutes: endMinutes }));

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PUT(request: Request) {
  const { id, startMinutes, endMinutes, override = false } = await request.json();

  if (id == null || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "id, startMinutes, endMinutes required" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // "*" rather than a column list: generation_run_id only exists once
  // migration 0034 is applied.
  const { data: existing } = await supabase
    .from("draft_schedules")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (!existing)
    return NextResponse.json({ error: "Draft shift not found" }, { status: 404 });

  const dateStr = typeof existing.date === "string" ? existing.date.slice(0, 10) : existing.date;
  const overlap = await findShiftOverlap(supabase, "draft_schedules", orgId!, existing.employee_id, dateStr, startMinutes, endMinutes, id);
  if (overlap) return NextResponse.json({ error: overlap }, { status: 409 });

  const liveClash = await findLiveClash(supabase, orgId!, existing.employee_id, dateStr, startMinutes, endMinutes);
  if (liveClash) return liveClash;

  if (!override) {
    const conflict = await findConflict(supabase, orgId!, existing.employee_id, dateStr, startMinutes, endMinutes);
    if (conflict) return conflict;
  }

  // An Auto-schedule draft the manager edits becomes their own: another
  // version or an undo of that run leaves it alone.
  const changes: Record<string, number | null> = { start_minutes: startMinutes, end_minutes: endMinutes };
  if (existing.generation_run_id != null) changes.generation_run_id = null;

  const { error } = await supabase
    .from("draft_schedules")
    .update(changes)
    .eq("org_id", orgId)
    .eq("id", id);

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("draft_schedules")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
