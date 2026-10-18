import { NextResponse } from "next/server";
import { csvCell } from "@/lib/csv";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";
import { dateKeyInTz, daysBetweenKeys, localDayBoundsUtc, resolveTimezone } from "@/lib/dates";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/punches/export?from=YYYY-MM-DD&to=YYYY-MM-DD&employeeId=N
// Manager: all employees (or filtered by employeeId)
// Employee: own punches only
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const daysDiff = daysBetweenKeys(from, to);
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, isManager, employeeId } = ctx!;

  // Scope the query to the org's configured timezone so the [from, to] window
  // covers full *local* calendar days. Filtering on naive UTC boundaries drops
  // punches near the day edges (and, for a timezone behind UTC, the whole tail
  // of the last day), which surfaced as exports with missing or no rows.
  const { data: settingsData } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId)
    .eq("key", "timezone");
  const tz = resolveTimezone(settingsData?.[0]?.value);

  const rangeStart = localDayBoundsUtc(from, tz).start.toISOString();
  const rangeEnd   = localDayBoundsUtc(to, tz).end.toISOString();

  const filterEmpId = searchParams.get("employeeId");
  if (!isManager && !employeeId)
    return NextResponse.json({ error: "No employee record" }, { status: 403 });
  const onlyEmployee = !isManager ? employeeId : filterEmpId ? Number(filterEmpId) : null;

  const { data, error: fetchError, truncated } = await fetchAllRows((first, last) => {
    let query = supabase
      .from("punch_records")
      .select("*, employees!punch_records_employee_org_fkey(name)")
      .eq("org_id", orgId)
      .gte("punched_at", rangeStart)
      .lte("punched_at", rangeEnd);
    if (onlyEmployee != null) query = query.eq("employee_id", onlyEmployee);
    return query
      .order("employee_id")
      .order("punched_at")
      .order("id")
      .range(first, last);
  }, { maxRows: 10_000 });
  if (fetchError) {
    console.error("[api/punches/export GET]", fetchError);
    return NextResponse.json({ error: "Failed to fetch punch records" }, { status: 500 });
  }
  if (truncated)
    return NextResponse.json({ error: "Too many punches in this range — choose a shorter range" }, { status: 422 });

  const rows = data ?? [];

  writeAuditLog({
    action:       "punch.export",
    orgId,
    actorId:      user.id,
    resourceType: "punch_record",
    metadata: {
      from,
      to,
      employeeId: filterEmpId ? Number(filterEmpId) : null,
      rowCount:   rows.length,
      byManager:  isManager,
    },
  }).catch(() => {});

  // Timestamp (UTC) makes every row unambiguous: on the night clocks fall back,
  // the store's 1:00–1:59 AM happens twice and the local Time alone can't say
  // which one a punch was in.
  const headers = ["Employee", "Date", "Time", "Punch Type", "Manual", "Note", "Lat", "Lng", "Timestamp (UTC)"];
  const lines = [headers.join(",")];

  for (const r of rows) {
    const punchedAt = new Date(r.punched_at);
    const date = dateKeyInTz(punchedAt, tz);
    const time = punchedAt.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const empName = (r.employees as { name: string } | null)?.name ?? String(r.employee_id);
    lines.push([
      empName,
      date,
      time,
      r.punch_type,
      r.is_manual ? "yes" : "no",
      r.note ?? "",
      r.lat ?? "",
      r.lng ?? "",
      punchedAt.toISOString(),
    ].map(csvCell).join(","));
  }

  const csv = lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="timesheet_${from}_to_${to}.csv"`,
    },
  });
}
