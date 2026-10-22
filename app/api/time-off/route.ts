import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { addDaysToKey, isDateKey, todayKeyInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";
import { collapseTimeOffGroups, describeTimeOff, parseTimeOffRequest, requestDates, timeOffWindow } from "@/lib/time-off";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request?: Request) {
  const params = request ? new URL(request.url).searchParams : new URLSearchParams();
  const mine = params.get("mine") === "true";
  // A date range (the week board) also returns that range's approved requests,
  // so the board can show who is off; without one, managers get the pending queue.
  const from = params.get("from");
  const to = params.get("to");
  const range = from && to && isDateKey(from) && isDateKey(to) && from <= to ? { from, to } : null;
  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;

  if (isManager && !mine) {
    // Every pending request for this org, or a range's pending and approved ones.
    const base = supabase
      .from("time_off_requests")
      .select("id, employee_id, date, status, note, start_minutes, end_minutes, group_id")
      .eq("org_id", orgId);
    const filtered = range
      ? base.in("status", ["pending", "approved"]).gte("date", range.from).lte("date", range.to)
      : base.eq("status", "pending");
    const { data: requests, error: fetchError } = await filtered.order("date", { ascending: true });

    if (fetchError) {
      console.error("[api/time-off]", fetchError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Fetch employee names separately
    const employeeIds = [...new Set((requests ?? []).map((r) => r.employee_id))];
    const employeeMap: Record<number, string> = {};
    if (employeeIds.length > 0) {
      const { data: employees } = await supabase
        .from("employees")
        .select("id, name")
        .eq("org_id", orgId)
        .in("id", employeeIds);
      for (const emp of employees ?? []) {
        employeeMap[emp.id] = emp.name;
      }
    }

    const result = (requests ?? []).map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: employeeMap[r.employee_id] ?? "Unknown",
      date: r.date,
      status: r.status,
      note: r.note ?? undefined,
      ...timeOffFields(r),
    }));

    // The week board works per day; the queue lists each request once.
    return NextResponse.json({ requests: range ? result : collapseTimeOffGroups(result) });
  }

  // Employee: fetch own requests for next 90 days
  if (!employeeId) return NextResponse.json({ requests: [] });

  // Fetch employee name for response shaping
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (!emp) return NextResponse.json({ requests: [] });

  const today = todayKeyInTz(await getOrgTimezone(supabase, orgId));
  const ninetyDaysOut = addDaysToKey(today, 90);

  const { data: requests, error: fetchError } = await supabase
    .from("time_off_requests")
    .select("id, employee_id, date, status, note, start_minutes, end_minutes, group_id")
    .eq("org_id", orgId)
    .eq("employee_id", emp.id)
    .gte("date", today)
    .lte("date", ninetyDaysOut)
    .order("date", { ascending: true });

  if (fetchError) {
    console.error("[api/time-off]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const result = (requests ?? []).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: emp.name,
    date: r.date,
    status: r.status,
    note: r.note ?? undefined,
    ...timeOffFields(r),
  }));

  return NextResponse.json({ requests: collapseTimeOffGroups(result) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { employeeId, note } = body;

  if (!employeeId || !Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!body.date || !DATE_RE.test(body.date) || !isDateKey(body.date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId: ctxEmployeeId } = ctx!;

  // "Today" is the store's calendar day, not UTC's.
  const today = todayKeyInTz(await getOrgTimezone(supabase, orgId));
  const parsed = parseTimeOffRequest(body, today);
  if (parsed.error !== null) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const req = parsed.request;

  // Verify the employee belongs to the current user and is in the same org
  // (Only allow submitting for your own employee record)
  if (!ctxEmployeeId || ctxEmployeeId !== employeeId)
    return NextResponse.json(
      { error: "Employee not found or not linked to your account" },
      { status: 403 }
    );

  // Fetch employee name for audit log
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (!emp)
    return NextResponse.json(
      { error: "Employee not found or not linked to your account" },
      { status: 403 }
    );

  const dates = requestDates(req);
  // One request per person per day (a unique key): name the days already asked for.
  const { data: existing } = await supabase
    .from("time_off_requests")
    .select("date")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("date", dates[0])
    .lte("date", dates[dates.length - 1]);
  const taken = ((existing ?? []) as { date: string }[]).map((r) => String(r.date).slice(0, 10)).sort();
  if (taken.length > 0) {
    return NextResponse.json(
      {
        error: dates.length === 1
          ? "You already requested this day off"
          : `You already have a request for ${taken.length === 1 ? describeTimeOff(taken, null) : `${taken.length} of these days`}`,
        dates: taken,
      },
      { status: 409 }
    );
  }

  const trimmedNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
  const groupId = dates.length > 1 ? randomUUID() : null;
  const rows = dates.map((date) => {
    const row: Record<string, unknown> = { employee_id: employeeId, date };
    if (trimmedNote) row.note = trimmedNote;
    if (groupId) row.group_id = groupId;
    if (req.window) {
      row.start_minutes = req.window.startMinutes;
      row.end_minutes = req.window.endMinutes;
    }
    return withOrg(orgId, row);
  });

  const { data, error: insertError } = await supabase
    .from("time_off_requests")
    .insert(rows)
    .select("id");

  // Another request for one of these days landed in between.
  if (insertError?.code === "23505")
    return NextResponse.json({ error: "You already requested this day off" }, { status: 409 });
  if (insertError) {
    console.error("[api/time-off]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ids = ((data ?? []) as { id: number }[]).map((r) => r.id);
  writeAuditLog({
    action:       "time_off.request",
    orgId,
    actorId:      user.id,
    resourceType: "time_off_request",
    resourceId:   String(ids[0] ?? ""),
    after: { employeeId, date: req.date, endDate: req.endDate, window: req.window, note: trimmedNote },
    metadata: {
      employeeId,
      employeeName: emp.name,
      date: req.date,
      endDate: req.endDate,
      days: dates.length,
    },
  }).catch(() => {});

  return NextResponse.json({ id: ids[0] ?? null, ids, groupId, ok: true }, { status: 201 });
}

// The API shape of a request's part-day window and group.
function timeOffFields(r: { start_minutes?: number | null; end_minutes?: number | null; group_id?: string | null }) {
  const window = timeOffWindow(r);
  return {
    startMinutes: window?.startMinutes ?? null,
    endMinutes:   window?.endMinutes ?? null,
    groupId:      r.group_id ?? null,
  };
}
