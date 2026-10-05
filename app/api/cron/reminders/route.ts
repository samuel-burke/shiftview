import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { notify } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";
import { addDaysToKey, DEFAULT_TIMEZONE, formatDateKey, resolveTimezone, todayKeyInTz } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cron has no authenticated user session — use admin client to read schedules/employees,
  // then use the same client to call SECURITY DEFINER notify RPCs.
  const supabase = createAdminClient();

  // Demo tenants get no reminders: their "employees" are seeded sample data
  // and their members are anonymous visitors.
  const { data: demoOrgs, error: demoErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("is_demo", true);
  if (demoErr) {
    console.error("[cron/reminders] demo orgs fetch failed:", demoErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const demoOrgIds = new Set((demoOrgs ?? []).map((o) => o.id));

  // "Tomorrow" is per org, in each store's own timezone. Candidate dates span
  // every zone's possible tomorrow; each row is then kept only if it is
  // tomorrow for its org.
  const { data: tzRows } = await supabase
    .from("app_settings")
    .select("org_id, value")
    .eq("key", "timezone");
  const tzByOrg = new Map<string, string>(
    (tzRows ?? []).map((r: { org_id: string; value: string }) => [r.org_id, resolveTimezone(r.value)])
  );
  const tomorrowFor = (orgId: string) =>
    addDaysToKey(todayKeyInTz(tzByOrg.get(orgId) ?? DEFAULT_TIMEZONE), 1);
  const utcToday = todayKeyInTz("UTC");
  const candidateDates = [0, 1, 2].map((n) => addDaysToKey(utcToday, n));

  const { data: allSchedules, error: schedErr } = await supabase
    .from("schedules")
    .select("id, employee_id, org_id, date, start_minutes, end_minutes")
    .in("date", candidateDates);
  const schedules = (allSchedules ?? []).filter(
    (s) => !demoOrgIds.has(s.org_id) && s.date === tomorrowFor(s.org_id)
  );

  if (schedErr) {
    console.error("[cron/reminders] schedules fetch failed:", schedErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!schedules || schedules.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  const employeeIds = [...new Set(schedules.map((s) => s.employee_id))];

  const { data: employees, error: empErr } = await supabase
    .from("employees")
    .select("id, org_id, name, user_id")
    .in("id", employeeIds);

  if (empErr) {
    console.error("[cron/reminders] employees fetch failed:", empErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Key employees by `${org_id}:${id}` because employee ids are only unique
  // per org — the same numeric id can appear in multiple organizations.
  const empMap = new Map(
    (employees ?? []).map((e) => [`${e.org_id}:${e.id}`, e])
  );

  let sent = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    const employee = empMap.get(`${schedule.org_id}:${schedule.employee_id}`);
    if (!employee?.user_id) {
      skipped++;
      continue;
    }

    const date: string = schedule.date;
    const formattedDate = formatDateKey(date, { weekday: "long", month: "long", day: "numeric" });
    const startTime = fmtMinutes(schedule.start_minutes);
    const endTime = fmtMinutes(schedule.end_minutes);

    await notify(supabase, {
      orgId: schedule.org_id,
      userId: employee.user_id,
      type: "shift_reminder",
      title: "Shift Reminder",
      body: `You're scheduled tomorrow, ${formattedDate}: ${startTime} – ${endTime}`,
      data: { date, scheduleId: schedule.id },
    }).catch(() => {});

    sent++;
  }

  return NextResponse.json({ sent, skipped });
}
