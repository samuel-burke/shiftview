import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { addDaysToKey, isDateKey, todayKeyInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";
import { isRequestExpired } from "@/lib/request-expiry";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request?: Request) {
  const mine = request ? new URL(request.url).searchParams.get("mine") === "true" : false;
  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;

  if (isManager && !mine) {
    // Fetch the org's pending requests that can still be decided: a request
    // expires once its day arrives (see lib/request-expiry.ts).
    const today = todayKeyInTz(await getOrgTimezone(supabase, orgId));
    const { data: requests, error: fetchError } = await supabase
      .from("time_off_requests")
      .select("id, employee_id, date, status, note")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .gt("date", today)
      .order("date", { ascending: true });

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
    .select("id, employee_id, date, status, note")
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
    // Still pending on its day means it wasn't approved in time: it's denied
    // from the store's midnight, before the nightly job records it.
    status: r.status === "pending" && isRequestExpired(r.date, today) ? "denied" : r.status,
    note: r.note ?? undefined,
  }));

  return NextResponse.json({ requests: result });
}

export async function POST(request: Request) {
  const { employeeId, date, note } = await request.json();

  if (!employeeId || !Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!date || !DATE_RE.test(date) || !isDateKey(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId: ctxEmployeeId } = ctx!;

  // "Today" is the store's calendar day, not UTC's. A request for today would
  // already have expired, so it must be for a later day.
  const today = todayKeyInTz(await getOrgTimezone(supabase, orgId));
  if (isRequestExpired(date, today))
    return NextResponse.json({ error: "date must be after today" }, { status: 400 });

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

  const insertRow: Record<string, unknown> = { employee_id: employeeId, date };
  if (note && typeof note === "string" && note.trim()) insertRow.note = note.trim();

  const { data, error: insertError } = await supabase
    .from("time_off_requests")
    .insert(withOrg(orgId, insertRow))
    .select("id")
    .single();

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
    after: { employeeId, date, note: insertRow.note ?? null },
    metadata: {
      employeeId,
      employeeName: emp.name,
      date,
    },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}
