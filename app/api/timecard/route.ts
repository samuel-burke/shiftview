import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { parsePunchPolicy } from "@/lib/punch-policy";
import { computeTimecard, type TimecardPunchInput } from "@/lib/timecard";
import { timecardToCsv } from "@/lib/timecard-csv";
import { writeAuditLog } from "@/lib/audit";
import type { PunchType } from "@/data/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/timecard?employeeId=N&from=YYYY-MM-DD&to=YYYY-MM-DD
// Manager-only. Returns one employee's punches, hours, call-outs and the punch
// violations they triggered under the org's configured PunchPolicy.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const employeeIdRaw = searchParams.get("employeeId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const employeeId = Number(employeeIdRaw);
  if (!employeeIdRaw || !Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const daysDiff =
    (new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime()) / 86_400_000;
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, user, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const format = searchParams.get("format");

  // Confirm the employee belongs to this org (tenant scoping).
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId!)
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  // Settings → timezone + punch policy.
  const { data: settingsData } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId!);
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = settingsMap.timezone ?? "America/New_York";
  const policy = parsePunchPolicy(settingsMap);

  // Schedules for the employee in range.
  const { data: scheduleRows, error: schedErr } = await supabase
    .from("schedules")
    .select("date, start_minutes, end_minutes")
    .eq("org_id", orgId!)
    .eq("employee_id", employeeId)
    .gte("date", from)
    .lte("date", to);
  if (schedErr) {
    console.error("[api/timecard] schedules", schedErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Punches — pad the window by a day on each side so timezone-edge punches land
  // in the right local-day bucket; computeTimecard restricts to [from, to].
  const padStart = `${from}T00:00:00+00:00`;
  const padEnd = new Date(new Date(to + "T23:59:59.999Z").getTime() + 86_400_000).toISOString();
  const { data: punchRows, error: punchErr } = await supabase
    .from("punch_records")
    .select("id, punch_type, punched_at, is_manual, note")
    .eq("org_id", orgId!)
    .eq("employee_id", employeeId)
    .gte("punched_at", new Date(new Date(padStart).getTime() - 86_400_000).toISOString())
    .lte("punched_at", padEnd)
    .order("punched_at")
    .limit(10_000);
  if (punchErr) {
    console.error("[api/timecard] punches", punchErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Call-outs in range.
  const { data: calloutRows, error: calloutErr } = await supabase
    .from("callouts")
    .select("date, reason")
    .eq("org_id", orgId!)
    .eq("employee_id", employeeId)
    .gte("date", from)
    .lte("date", to);
  if (calloutErr) {
    console.error("[api/timecard] callouts", calloutErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const timecard = computeTimecard({
    employeeId,
    employeeName: emp.name,
    from,
    to,
    timezone: tz,
    policy,
    schedules: (scheduleRows ?? []).map((s) => ({
      date: s.date,
      startMinutes: s.start_minutes,
      endMinutes: s.end_minutes,
    })),
    punches: (punchRows ?? []).map((p): TimecardPunchInput => ({
      id: p.id,
      punchType: p.punch_type as PunchType,
      punchedAt: p.punched_at,
      isManual: p.is_manual,
      note: p.note,
    })),
    callouts: (calloutRows ?? []).map((c) => ({ date: c.date, reason: c.reason })),
  });

  if (format === "csv") {
    writeAuditLog({
      action:       "timecard.export",
      orgId:        orgId!,
      actorId:      user?.id,
      resourceType: "punch_record",
      metadata: {
        from,
        to,
        employeeId,
        rowCount:        timecard.days.length,
        totalViolations: timecard.totalViolations,
      },
    }).catch(() => {});

    const safeName = emp.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return new Response(timecardToCsv(timecard), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="timecard_${safeName || employeeId}_${from}_to_${to}.csv"`,
      },
    });
  }

  return NextResponse.json(timecard);
}
