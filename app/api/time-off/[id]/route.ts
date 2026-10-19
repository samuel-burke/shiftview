import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { addDaysToKey } from "@/lib/dates";
import { fmtMinutes } from "@/data/types";
import { describeTimeOff, shiftsDuringTimeOff, timeOffWindow, type ScheduledShift } from "@/lib/time-off";

export const dynamic = "force-dynamic";

type RequestRow = {
  id: number;
  employee_id: number;
  date: string;
  status: string;
  start_minutes: number | null;
  end_minutes: number | null;
  group_id: string | null;
};

// PUT /api/time-off/:id { status: "approved" | "denied", resolve?: "remove" | "keep" }
//
// Decides a request, and every other day of a multi-day request with it.
// Approving time off that clashes with the person's live shifts answers 409
// with those shifts until the manager chooses: "remove" deletes them (and
// tells the employee), "keep" approves and leaves them.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || isNaN(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const { status, resolve } = await request.json().catch(() => ({}));
  if (status !== "approved" && status !== "denied")
    return NextResponse.json(
      { error: 'status must be "approved" or "denied"' },
      { status: 400 }
    );
  if (resolve !== undefined && resolve !== "remove" && resolve !== "keep")
    return NextResponse.json({ error: 'resolve must be "remove" or "keep"' }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const COLUMNS = "id, employee_id, date, status, start_minutes, end_minutes, group_id";
  const { data: pto } = await supabase
    .from("time_off_requests")
    .select(COLUMNS)
    .eq("org_id", orgId!)
    .eq("id", id)
    .maybeSingle();
  if (!pto) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const first = pto as RequestRow;

  // The request's days: the whole group for a multi-day request.
  let rows: RequestRow[] = [first];
  if (first.group_id) {
    const { data: group } = await supabase
      .from("time_off_requests")
      .select(COLUMNS)
      .eq("org_id", orgId!)
      .eq("employee_id", first.employee_id)
      .eq("group_id", first.group_id);
    if (Array.isArray(group) && group.length > 0) rows = group as RequestRow[];
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const dates = rows.map((r) => String(r.date).slice(0, 10));
  const window = timeOffWindow(first);
  const label = describeTimeOff(dates, window);

  // Live shifts the time off would leave in place. An overnight shift from the
  // day before reaches into the first day, so that day is read too.
  let clashing: ScheduledShift[] = [];
  if (status === "approved") {
    const { data: shifts } = await supabase
      .from("schedules")
      .select("id, employee_id, date, start_minutes, end_minutes")
      .eq("org_id", orgId!)
      .eq("employee_id", first.employee_id)
      .gte("date", addDaysToKey(dates[0], -1))
      .lte("date", dates[dates.length - 1]);
    clashing = shiftsDuringTimeOff(
      ((shifts ?? []) as { id: number; employee_id: number; date: string; start_minutes: number; end_minutes: number }[]).map((s) => ({
        id: s.id,
        employeeId: s.employee_id,
        date: String(s.date).slice(0, 10),
        startMinutes: s.start_minutes,
        endMinutes: s.end_minutes,
      })),
      rows.map((r) => ({ date: String(r.date).slice(0, 10), window: timeOffWindow(r) }))
    );
    if (clashing.length > 0 && resolve === undefined) {
      return NextResponse.json(
        {
          conflict: "scheduled",
          message: clashing.length === 1
            ? `They're scheduled ${describeShift(clashing[0])} during this time off.`
            : `They have ${clashing.length} shifts scheduled during this time off.`,
          shifts: clashing.map(({ id: sid, date, startMinutes, endMinutes }) => ({ id: sid, date, startMinutes, endMinutes })),
        },
        { status: 409 }
      );
    }
  }

  const { error } = await supabase
    .from("time_off_requests")
    .update({ status })
    .eq("org_id", orgId!)
    .in("id", rows.map((r) => r.id));

  if (error) {
    console.error("[api/time-off/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Take the clashing shifts off the schedule (and any drafts for those days
  // that would put them back on publish).
  let removed: ScheduledShift[] = [];
  if (clashing.length > 0 && resolve === "remove") {
    const { data: deleted, error: deleteError } = await supabase
      .from("schedules")
      .delete()
      .eq("org_id", orgId!)
      .in("id", clashing.map((s) => s.id))
      .select("id");
    if (deleteError) {
      console.error("[api/time-off/[id]] removing shifts", deleteError);
      return NextResponse.json({ error: "Approved, but the shifts couldn't be removed. Remove them on the Week page." }, { status: 500 });
    }
    const gone = new Set(((deleted ?? []) as { id: number }[]).map((d) => d.id));
    removed = clashing.filter((s) => gone.has(s.id));
    const { data: drafts } = await supabase
      .from("draft_schedules")
      .select("id, employee_id, date, start_minutes, end_minutes")
      .eq("org_id", orgId!)
      .eq("employee_id", first.employee_id)
      .gte("date", addDaysToKey(dates[0], -1))
      .lte("date", dates[dates.length - 1]);
    const clashingDrafts = shiftsDuringTimeOff(
      ((drafts ?? []) as { id: number; employee_id: number; date: string; start_minutes: number; end_minutes: number }[]).map((s) => ({
        id: s.id, employeeId: s.employee_id, date: String(s.date).slice(0, 10), startMinutes: s.start_minutes, endMinutes: s.end_minutes,
      })),
      rows.map((r) => ({ date: String(r.date).slice(0, 10), window: timeOffWindow(r) }))
    );
    if (clashingDrafts.length > 0) {
      await supabase.from("draft_schedules").delete().eq("org_id", orgId!).in("id", clashingDrafts.map((d) => d.id));
    }
  }

  // Notify the employee of the decision
  const { data: emp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("org_id", orgId!)
    .eq("id", first.employee_id)
    .maybeSingle();
  const empName: string | null = emp?.name ?? null;
  if (emp?.user_id) {
    const removedText = removed.length === 0
      ? ""
      : removed.length === 1
      ? ` Your shift ${describeShift(removed[0])} was removed.`
      : ` ${removed.length} shifts during that time were removed from your schedule.`;
    notify({
      orgId: orgId!,
      userId: emp.user_id,
      type: status === "approved" ? "pto_approved" : "pto_denied",
      title: status === "approved" ? "Time Off Approved" : "Time Off Denied",
      body: status === "approved"
        ? `Your time-off request for ${label} has been approved.${removedText}`
        : `Your time-off request for ${label} was denied.`,
      data: { ptoId: id, date: dates[0], dates, removedShiftIds: removed.map((s) => s.id) },
    }).catch(() => {});
  }

  writeAuditLog({
    action:       status === "approved" ? "time_off.approve" : "time_off.deny",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "time_off_request",
    resourceId:   String(id),
    before:       { status: first.status },
    after:        { status, removedShifts: removed.map((s) => s.id), keptShifts: resolve === "keep" ? clashing.map((s) => s.id) : [] },
    metadata: {
      employeeId:   first.employee_id,
      employeeName: empName,
      date:         dates[0],
      dates,
    },
  }).catch(() => {});

  for (const s of removed) {
    writeAuditLog({
      action:       "schedule.delete",
      orgId:        orgId!,
      actorId:      user?.id,
      resourceType: "schedule",
      resourceId:   String(s.id),
      before:       { employeeId: s.employeeId, date: s.date, startMinutes: s.startMinutes, endMinutes: s.endMinutes },
      metadata:     { employeeId: s.employeeId, employeeName: empName, date: s.date, reason: "time_off_approved" },
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    ids: rows.map((r) => r.id),
    removedShifts: removed.map((s) => s.id),
    keptShifts: resolve === "keep" ? clashing.map((s) => s.id) : [],
  });
}

function describeShift(s: { date: string; startMinutes: number; endMinutes: number }): string {
  const day = new Date(`${s.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
  return `${day} ${fmtMinutes(s.startMinutes)} – ${fmtMinutes(s.endMinutes)}`;
}
