import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { notifyManagers } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { addDaysToKey, isDateKey, localDayBoundsUtc, todayKeyInTz } from "@/lib/dates";
import { calloutBlockReason } from "@/lib/callout-rules";
import { getOrgTimezone } from "@/lib/org-timezone";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/callouts
//   ?date=YYYY-MM-DD → every call-out in the org for that day (any member; the
//                      team dashboard uses this to flag "Called Out" status).
//   ?mine=true       → the caller's own upcoming call-outs.
//   (no params)      → every upcoming call-out in the org.
export async function GET(request?: Request) {
  const params = request ? new URL(request.url).searchParams : null;
  const mine = params?.get("mine") === "true";
  const date = params?.get("date") ?? null;
  if (date && !DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, employeeId, isManager } = ctx!;
  // Only the upcoming lists need the store's today; the dashboard's single-day
  // read skips the timezone lookup.
  const storeToday = async () => todayKeyInTz(await getOrgTimezone(supabase, orgId));

  // Employee's own call-outs (next 90 days), mirroring the time-off "mine" path.
  if (mine) {
    if (!employeeId) return NextResponse.json({ callouts: [] });

    const today = await storeToday();
    const ninetyDaysOut = addDaysToKey(today, 90);

    const { data: emp } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("id", employeeId)
      .maybeSingle();
    if (!emp) return NextResponse.json({ callouts: [] });

    const { data: rows, error: fetchError } = await supabase
      .from("callouts")
      .select("id, employee_id, date, reason")
      .eq("org_id", orgId)
      .eq("employee_id", emp.id)
      .gte("date", today)
      .lte("date", ninetyDaysOut)
      .order("date", { ascending: true });

    if (fetchError) {
      console.error("[api/callouts]", fetchError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({
      callouts: (rows ?? []).map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: emp.name,
        date: r.date,
        reason: r.reason ?? undefined,
      })),
    });
  }

  // Org-wide: a specific day (dashboard) or everything upcoming.
  let query = supabase
    .from("callouts")
    .select("id, employee_id, date, reason")
    .eq("org_id", orgId)
    .order("date", { ascending: true });
  query = date ? query.eq("date", date) : query.gte("date", await storeToday());

  const { data: rows, error: fetchError } = await query;
  if (fetchError) {
    console.error("[api/callouts]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Resolve employee names in one batch.
  const employeeIds = [...new Set((rows ?? []).map((r) => r.employee_id))];
  const employeeMap: Record<number, string> = {};
  if (employeeIds.length > 0) {
    const { data: employees } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", employeeIds);
    for (const emp of employees ?? []) employeeMap[emp.id] = emp.name;
  }

  // Everyone sees who called out; the reason (often medical) is for managers
  // and the person who called out.
  return NextResponse.json({
    callouts: (rows ?? []).map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: employeeMap[r.employee_id] ?? "Unknown",
      date: r.date,
      reason: isManager || r.employee_id === employeeId ? (r.reason ?? undefined) : undefined,
    })),
  });
}

// POST /api/callouts — file a call-out for yourself.
export async function POST(request: Request) {
  const { employeeId, date, reason } = await request.json();

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

  // You can only call out for your own employee record.
  if (!ctxEmployeeId || ctxEmployeeId !== employeeId)
    return NextResponse.json(
      { error: "Employee not found or not linked to your account" },
      { status: 403 }
    );

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

  // Only for a shift scheduled today or tomorrow (the store's calendar days),
  // and not for today's shift once clocked in for it (lib/callout-rules.ts).
  const tz = await getOrgTimezone(supabase, orgId);
  const today = todayKeyInTz(tz);
  const [{ data: shifts }, { data: clockIns }] = await Promise.all([
    supabase
      .from("schedules")
      .select("id")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("date", date)
      .limit(1),
    date === today
      ? supabase
          .from("punch_records")
          .select("id")
          .eq("org_id", orgId)
          .eq("employee_id", employeeId)
          .eq("punch_type", "clock_in")
          .gte("punched_at", localDayBoundsUtc(today, tz).start.toISOString())
          .lte("punched_at", localDayBoundsUtc(today, tz).end.toISOString())
          .limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  const blockReason = calloutBlockReason({
    date,
    todayKey: today,
    hasShift: Array.isArray(shifts) && shifts.length > 0,
    clockedInToday: Array.isArray(clockIns) && clockIns.length > 0,
  });
  if (blockReason) return NextResponse.json({ error: blockReason }, { status: 400 });

  const trimmedReason =
    reason && typeof reason === "string" && reason.trim() ? reason.trim() : null;

  // Upsert so re-filing the same day just updates the reason (idempotent).
  const { data, error: upsertError } = await supabase
    .from("callouts")
    .upsert(
      withOrg(orgId, {
        employee_id: employeeId,
        date,
        reason: trimmedReason,
        created_by: user.id,
      }),
      { onConflict: "org_id,employee_id,date" }
    )
    .select("id")
    .single();

  if (upsertError) {
    console.error("[api/callouts]", upsertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Let the managers know right away (in-app + push, pref-gated).
  notifyManagers(
    orgId,
    "callout",
    "Call-Out",
    trimmedReason
      ? `${emp.name} called out for ${date}: ${trimmedReason}`
      : `${emp.name} called out for ${date}.`,
    { calloutId: data.id, employeeId, date }
  ).catch(() => {});

  writeAuditLog({
    action:       "callout.create",
    orgId,
    actorId:      user.id,
    resourceType: "callout",
    resourceId:   String(data.id),
    after:        { employeeId, date, reason: trimmedReason },
    metadata:     { employeeId, employeeName: emp.name, date },
  }).catch(() => {});

  return NextResponse.json({ id: data.id, ok: true }, { status: 201 });
}
