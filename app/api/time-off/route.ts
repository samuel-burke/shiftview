import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { addDaysToKey, isDateKey, todayKeyInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";
import { isRequestLeaveType, isValidPaidHours } from "@/lib/pto";
import { loadBalances, requestLeaveFields } from "@/lib/pto-server";

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
      .select("id, employee_id, date, status, note, leave_type, paid_hours")
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

    // Each paid request carries the employee's balance for its type, so the
    // manager sees whether approving it would overdraw.
    const { balances } = employeeIds.length > 0 ? await loadBalances(supabase, orgId) : { balances: [] };
    const balanceOf = new Map(balances.map((b) => [b.employeeId, b]));

    const result = (requests ?? []).map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: employeeMap[r.employee_id] ?? "Unknown",
      balance: r.leave_type === "pto" || r.leave_type === "sick"
        ? balanceOf.get(r.employee_id)?.[r.leave_type as "pto" | "sick"] ?? 0
        : null,
      date: r.date,
      status: r.status,
      note: r.note ?? undefined,
      leaveType: r.leave_type ?? "unpaid",
      paidHours: r.paid_hours == null ? null : Number(r.paid_hours),
    }));

    return NextResponse.json({ requests: result });
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
    .select("id, employee_id, date, status, note, leave_type, paid_hours")
    .eq("org_id", orgId)
    .eq("employee_id", emp.id)
    // A cancelled request frees its day.
    .in("status", ["pending", "approved", "denied"])
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
    leaveType: r.leave_type ?? "unpaid",
    paidHours: r.paid_hours == null ? null : Number(r.paid_hours),
  }));

  return NextResponse.json({ requests: result });
}

export async function POST(request: Request) {
  const { employeeId, date, note, leaveType = "unpaid", paidHours } = await request.json();

  if (!employeeId || !Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!date || !DATE_RE.test(date) || !isDateKey(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if (!isRequestLeaveType(leaveType))
    return NextResponse.json({ error: "leaveType must be unpaid, pto or sick" }, { status: 400 });
  if (paidHours !== undefined && paidHours !== null && !isValidPaidHours(paidHours))
    return NextResponse.json({ error: "paidHours must be more than 0 and at most 24" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId: ctxEmployeeId } = ctx!;

  // "Today" is the store's calendar day, not UTC's.
  const tz = await getOrgTimezone(supabase, orgId);
  const today = todayKeyInTz(tz);
  if (date < today)
    return NextResponse.json({ error: "date must be today or in the future" }, { status: 400 });

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

  const insertRow: Record<string, unknown> = {
    employee_id: employeeId,
    date,
    ...(await requestLeaveFields(supabase, orgId, employeeId, date, tz, leaveType, paidHours ?? undefined)),
  };
  if (note && typeof note === "string" && note.trim()) insertRow.note = note.trim();

  const { data, error: insertError } = await supabase
    .from("time_off_requests")
    .insert(withOrg(orgId, insertRow))
    .select("id")
    .single();

  // One request per person per day (a unique key): a denied day can't be re-requested.
  if (insertError?.code === "23505")
    return NextResponse.json({ error: "You already requested this day off" }, { status: 409 });
  if (insertError) {
    console.error("[api/time-off]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "time_off.request",
    orgId,
    actorId:      user.id,
    resourceType: "time_off_request",
    resourceId:   String(data.id),
    after: { employeeId, date, note: insertRow.note ?? null, leaveType: insertRow.leave_type, paidHours: insertRow.paid_hours },
    metadata: {
      employeeId,
      employeeName: emp.name,
      date,
    },
  }).catch(() => {});

  return NextResponse.json(
    { id: data.id, ok: true, leaveType: insertRow.leave_type, paidHours: insertRow.paid_hours },
    { status: 201 },
  );
}
