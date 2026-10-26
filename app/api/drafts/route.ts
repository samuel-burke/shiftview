import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { parseShiftNote, validateShiftMinutes } from "@/app/api/schedules/validation";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { weekDates } from "@/lib/draft-metrics";
import { findRuleConflict, findShiftConflict, findShiftOverlap } from "@/lib/shift-conflicts-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// The live schedule wins over a new draft. A draft can't go on a day the
// employee already has a published shift (publish would skip it and the
// change would be lost) unless it is a change to that shift, or overlap a live
// overnight shift. Live shifts other drafts change or remove count as those
// drafts say (they're checked as drafts). Not overridable.
async function findLiveClash(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: number,
  date: string,
  startMinutes: number,
  endMinutes: number,
  replacesScheduleId: number | null = null
): Promise<NextResponse | null> {
  const [{ data: live }, { data: changes }] = await Promise.all([
    supabase
      .from("schedules")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("date", date),
    supabase
      .from("draft_schedules")
      .select("replaces_schedule_id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId),
  ]);
  const superseded = new Set(
    ((Array.isArray(changes) ? changes : []) as { replaces_schedule_id?: number | null }[])
      .map((c) => c.replaces_schedule_id)
      .filter((id): id is number => id != null)
  );
  if (replacesScheduleId != null) superseded.add(replacesScheduleId);
  const others = ((Array.isArray(live) ? live : []) as { id: number }[]).filter((r) => !superseded.has(r.id));
  if (others.length > 0)
    return NextResponse.json({ error: "Already has a live shift that day. Change that shift instead.", live: true }, { status: 409 });
  const overlap = await findShiftOverlap(supabase, "schedules", orgId, employeeId, date, startMinutes, endMinutes, [...superseded]);
  return overlap ? NextResponse.json({ error: `${overlap} (live)`, live: true }, { status: 409 }) : null;
}

async function findConflict(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: number,
  shift: { id?: number; date: string; startMinutes: number; endMinutes: number; replacesScheduleId?: number }
): Promise<NextResponse | null> {
  const conflict = await findShiftConflict(supabase, orgId, employeeId, shift.date, shift.startMinutes, shift.endMinutes);
  if (conflict) return NextResponse.json(conflict, { status: 409 });
  const rules = await findRuleConflict(supabase, orgId, "draft_schedules", employeeId, shift);
  return rules ? NextResponse.json(rules, { status: 409 }) : null;
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
    ...(s.note ? { note: s.note } : {}),
    // The Auto-schedule run that created it (null if made by hand).
    generationRunId: s.generation_run_id ?? null,
    // A change to a live shift: the shift it changes, and whether it removes it.
    ...(s.replaces_schedule_id != null ? { replacesScheduleId: s.replaces_schedule_id, removes: s.removes === true } : {}),
  }));

  return NextResponse.json(mapped);
}

// POST /api/drafts
//   { employeeId, date, startMinutes, endMinutes, note?, override? }   a new shift
//   { replacesScheduleId, startMinutes, endMinutes, note?, override? } a change to a live shift
//   { replacesScheduleId, remove: true }                               takes a live shift off
// Changes and removals publish with the rest of the week's drafts, in one
// notification per person.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body.replacesScheduleId != null) return draftChange(request, body);
  const { employeeId, date, startMinutes, endMinutes, override = false, note: rawNote } = body;

  if (employeeId == null || !date || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "employeeId, date, startMinutes, endMinutes required" }, { status: 400 });
  if (!DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });
  const { note, error: noteError } = parseShiftNote(rawNote);
  if (noteError) return NextResponse.json({ error: noteError }, { status: 422 });

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
    const conflict = await findConflict(supabase, orgId!, employeeId, { date, startMinutes, endMinutes });
    if (conflict) return conflict;
  }

  const { error } = await supabase
    .from("draft_schedules")
    .insert(withOrg(orgId!, { employee_id: employeeId, date, start_minutes: startMinutes, end_minutes: endMinutes, ...(note ? { note } : {}) }));

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

async function draftChange(request: Request, body: Record<string, unknown>) {
  const { replacesScheduleId, remove = false, override = false } = body;
  if (!Number.isInteger(replacesScheduleId))
    return NextResponse.json({ error: "replacesScheduleId must be an integer" }, { status: 400 });
  if (typeof remove !== "boolean")
    return NextResponse.json({ error: "remove must be true or false" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: live } = await supabase
    .from("schedules")
    .select("id, employee_id, date, start_minutes, end_minutes, note")
    .eq("org_id", orgId)
    .eq("id", replacesScheduleId as number)
    .maybeSingle();
  if (!live) return NextResponse.json({ error: "Live shift not found" }, { status: 404 });
  const date = String(live.date).slice(0, 10);

  // One draft per person per day: a new draft that day already stands in the way.
  const { data: existing } = await supabase
    .from("draft_schedules")
    .select("id")
    .eq("org_id", orgId)
    .eq("employee_id", live.employee_id)
    .eq("date", date)
    .maybeSingle();
  if (existing)
    return NextResponse.json({ error: "There's already a draft for this person that day. Edit or remove it first." }, { status: 409 });

  let row: Record<string, unknown>;
  if (remove) {
    row = {
      employee_id: live.employee_id, date, start_minutes: live.start_minutes, end_minutes: live.end_minutes,
      replaces_schedule_id: live.id, removes: true,
    };
  } else {
    const startMinutes = body.startMinutes as number;
    const endMinutes = body.endMinutes as number;
    if (startMinutes == null || endMinutes == null)
      return NextResponse.json({ error: "startMinutes and endMinutes required" }, { status: 400 });
    const validationError = validateShiftMinutes(startMinutes, endMinutes);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });
    const { note, error: noteError } = parseShiftNote(body.note);
    if (noteError) return NextResponse.json({ error: noteError }, { status: 422 });

    const overlap = await findShiftOverlap(supabase, "draft_schedules", orgId!, live.employee_id, date, startMinutes, endMinutes);
    if (overlap) return NextResponse.json({ error: overlap }, { status: 409 });
    const liveClash = await findLiveClash(supabase, orgId!, live.employee_id, date, startMinutes, endMinutes, live.id);
    if (liveClash) return liveClash;
    if (!override) {
      const conflict = await findConflict(supabase, orgId!, live.employee_id, { date, startMinutes, endMinutes, replacesScheduleId: live.id });
      if (conflict) return conflict;
    }
    row = {
      employee_id: live.employee_id, date, start_minutes: startMinutes, end_minutes: endMinutes,
      note: note === undefined ? live.note ?? null : note,
      replaces_schedule_id: live.id,
    };
  }

  const { data: created, error } = await supabase
    .from("draft_schedules")
    .insert(withOrg(orgId!, row))
    .select("id")
    .single();
  if (error?.code === "23505")
    return NextResponse.json({ error: "This shift already has a draft change." }, { status: 409 });
  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: created?.id }, { status: 201 });
}

export async function PUT(request: Request) {
  const { id, startMinutes, endMinutes, override = false, note: rawNote } = await request.json();

  if (id == null || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "id, startMinutes, endMinutes required" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });
  const { note, error: noteError } = parseShiftNote(rawNote);
  if (noteError) return NextResponse.json({ error: noteError }, { status: 422 });

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

  const liveClash = await findLiveClash(supabase, orgId!, existing.employee_id, dateStr, startMinutes, endMinutes, existing.replaces_schedule_id ?? null);
  if (liveClash) return liveClash;

  if (!override) {
    const conflict = await findConflict(supabase, orgId!, existing.employee_id, { id, date: dateStr, startMinutes, endMinutes });
    if (conflict) return conflict;
  }

  // An Auto-schedule draft the manager edits becomes their own: another
  // version or an undo of that run leaves it alone.
  const changes: Record<string, number | string | boolean | null> = { start_minutes: startMinutes, end_minutes: endMinutes };
  // Editing a removal makes it a change to the shift's times instead.
  if (existing.removes === true) changes.removes = false;
  if (note !== undefined) changes.note = note;
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
