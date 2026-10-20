import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { describeTimeOff, timeOffWindow } from "@/lib/time-off";

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

// PUT /api/time-off/:id { status: "approved" | "denied" }
//
// Decides a request, and every other day of a multi-day request with it.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || isNaN(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const { status } = await request.json().catch(() => ({}));
  if (status !== "approved" && status !== "denied")
    return NextResponse.json(
      { error: 'status must be "approved" or "denied"' },
      { status: 400 }
    );

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

  const { error } = await supabase
    .from("time_off_requests")
    .update({ status })
    .eq("org_id", orgId!)
    .in("id", rows.map((r) => r.id));

  if (error) {
    console.error("[api/time-off/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
    notify({
      orgId: orgId!,
      userId: emp.user_id,
      type: status === "approved" ? "pto_approved" : "pto_denied",
      title: status === "approved" ? "Time Off Approved" : "Time Off Denied",
      body: status === "approved"
        ? `Your time-off request for ${label} has been approved.`
        : `Your time-off request for ${label} was denied.`,
      data: { ptoId: id, date: dates[0], dates },
    }).catch(() => {});
  }

  writeAuditLog({
    action:       status === "approved" ? "time_off.approve" : "time_off.deny",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "time_off_request",
    resourceId:   String(id),
    before:       { status: first.status },
    after:        { status },
    metadata: {
      employeeId:   first.employee_id,
      employeeName: empName,
      date:         dates[0],
      dates,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, ids: rows.map((r) => r.id) });
}
