import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";

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
    // Fetch all pending requests for this org
    const { data: requests, error: fetchError } = await supabase
      .from("time_off_requests")
      .select("id, employee_id, date, status, note")
      .eq("org_id", orgId)
      .eq("status", "pending")
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

  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysOut = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

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
    status: r.status,
    note: r.note ?? undefined,
  }));

  return NextResponse.json({ requests: result });
}

export async function POST(request: Request) {
  const { employeeId, date, note } = await request.json();

  if (!employeeId || !Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  if (date < today)
    return NextResponse.json({ error: "date must be today or in the future" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, employeeId: ctxEmployeeId } = ctx!;

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
