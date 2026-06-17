import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { weekDates } from "@/lib/draft-metrics";
import { splitAckStatus, type ScheduledEmployee, type AckRow } from "@/lib/schedule-ack";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/schedule-acks { weekStart } — the signed-in employee confirms
// they've seen their published schedule for that week.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { weekStart } = body;

  if (!weekStart || !DATE_RE.test(weekStart))
    return NextResponse.json({ error: "weekStart required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId } = ctx!;
  if (!employeeId)
    return NextResponse.json({ error: "No employee record found" }, { status: 403 });

  const { data, error: upsertError } = await supabase
    .from("schedule_acknowledgements")
    .upsert(
      withOrg(orgId, {
        employee_id: employeeId,
        week_start: weekStart,
        acknowledged_at: new Date().toISOString(),
      }),
      { onConflict: "org_id,employee_id,week_start" }
    )
    .select("id")
    .single();

  if (upsertError) {
    console.error("[api/schedule-acks]", upsertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "schedule.acknowledge",
    orgId,
    actorId:      user.id,
    resourceType: "schedule_acknowledgement",
    resourceId:   data?.id != null ? String(data.id) : null,
    after:        { employeeId, weekStart },
  }).catch(() => {});

  return NextResponse.json({ id: data?.id, ok: true }, { status: 201 });
}

// GET /api/schedule-acks?weekStart=YYYY-MM-DD
//   Manager  → confirmed/pending split across everyone scheduled that week.
//   Employee → the caller's own acknowledged boolean.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get("weekStart");
  if (!weekStart || !DATE_RE.test(weekStart))
    return NextResponse.json({ error: "weekStart required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;
  const dates = weekDates(weekStart);

  if (!isManager) {
    if (!employeeId) return NextResponse.json({ weekStart, acknowledged: false });
    const { data: rows } = await supabase
      .from("schedule_acknowledgements")
      .select("employee_id, acknowledged_at")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("week_start", weekStart);
    return NextResponse.json({ weekStart, acknowledged: (rows ?? []).length > 0 });
  }

  // Manager: who's scheduled this week vs who has acknowledged.
  const { data: scheduleRows, error: schedError } = await supabase
    .from("schedules")
    .select("employee_id")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6])
    .limit(10000);

  if (schedError) {
    console.error("[api/schedule-acks]", schedError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const employeeIds = [...new Set((scheduleRows ?? []).map((s) => s.employee_id))];
  if (employeeIds.length === 0) {
    return NextResponse.json({
      weekStart, confirmed: [], pending: [], confirmedCount: 0, pendingCount: 0, allConfirmed: false,
    });
  }

  const [{ data: employees }, { data: acks }] = await Promise.all([
    supabase.from("employees").select("id, name").eq("org_id", orgId).in("id", employeeIds),
    supabase
      .from("schedule_acknowledgements")
      .select("employee_id, acknowledged_at")
      .eq("org_id", orgId)
      .eq("week_start", weekStart),
  ]);

  const nameById = new Map<number, string>((employees ?? []).map((e) => [e.id, e.name]));
  const scheduled: ScheduledEmployee[] = employeeIds.map((id) => ({
    employeeId: id,
    employeeName: nameById.get(id) ?? "Unknown",
  }));
  const ackRows: AckRow[] = (acks ?? []).map((a) => ({
    employeeId: a.employee_id,
    acknowledgedAt: a.acknowledged_at,
  }));

  const status = splitAckStatus(scheduled, ackRows);
  return NextResponse.json({ weekStart, ...status });
}
