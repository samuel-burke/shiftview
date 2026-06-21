import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { localDayBoundsUtc, getLocalMinutes } from "@/lib/punch-date-utils";
import { parsePunchPolicy } from "@/lib/punch-policy";
import { classifyArrival, summarizePunctuality, type ArrivalStatus } from "@/lib/punctuality";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/punctuality?date=YYYY-MM-DD (manager-only)
// Compares each scheduled employee's earliest clock-in to their earliest
// scheduled start, classifying on_time / late / absent. The "late" grace comes
// from the org's punch policy (lateInMinutes); timezone from app_settings.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const { data: settingsRows } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId);
  const settings = Object.fromEntries((settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const tz = settings.timezone ?? "America/New_York";
  const grace = parsePunchPolicy(settings).lateInMinutes;

  // Earliest scheduled start per employee for the day.
  const { data: scheduleRows, error: schedErr } = await supabase
    .from("schedules")
    .select("employee_id, start_minutes")
    .eq("org_id", orgId)
    .eq("date", date)
    .limit(10000);
  if (schedErr) {
    console.error("[api/reports/punctuality]", schedErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const startByEmployee = new Map<number, number>();
  for (const s of scheduleRows ?? []) {
    const cur = startByEmployee.get(s.employee_id);
    startByEmployee.set(s.employee_id, cur == null ? s.start_minutes : Math.min(cur, s.start_minutes));
  }

  if (startByEmployee.size === 0) {
    return NextResponse.json({ date, rows: [], summary: summarizePunctuality([]) });
  }

  // Earliest clock-in per employee (in local minutes) within the day.
  const { start, end } = localDayBoundsUtc(date, tz);
  const { data: punchRows } = await supabase
    .from("punch_records")
    .select("employee_id, punch_type, punched_at")
    .eq("org_id", orgId)
    .gte("punched_at", start.toISOString())
    .lte("punched_at", end.toISOString())
    .limit(10000);

  const clockInByEmployee = new Map<number, number>();
  for (const p of punchRows ?? []) {
    if (p.punch_type !== "clock_in") continue;
    const mins = getLocalMinutes(new Date(p.punched_at), tz);
    const cur = clockInByEmployee.get(p.employee_id);
    clockInByEmployee.set(p.employee_id, cur == null ? mins : Math.min(cur, mins));
  }

  const ids = [...startByEmployee.keys()];
  const nameById = new Map<number, string>();
  const { data: emps } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .in("id", ids);
  for (const e of emps ?? []) nameById.set(e.id, e.name);

  const rows = ids.map((employeeId) => {
    const scheduledStart = startByEmployee.get(employeeId)!;
    const clockIn = clockInByEmployee.has(employeeId) ? clockInByEmployee.get(employeeId)! : null;
    const status: ArrivalStatus = classifyArrival(scheduledStart, clockIn, grace);
    return {
      employeeId,
      employeeName: nameById.get(employeeId) ?? "Unknown",
      scheduledStartMinutes: scheduledStart,
      clockInMinutes: clockIn,
      status,
    };
  });

  return NextResponse.json({
    date,
    graceMinutes: grace,
    rows,
    summary: summarizePunctuality(rows.map((r) => ({ status: r.status }))),
  });
}
