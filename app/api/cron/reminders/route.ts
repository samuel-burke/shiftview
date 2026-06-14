import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { notify } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);

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

  const { data: allSchedules, error: schedErr } = await supabase
    .from("schedules")
    .select("id, employee_id, org_id, date, start_minutes, end_minutes")
    .eq("date", date);
  const schedules = (allSchedules ?? []).filter((s) => !demoOrgIds.has(s.org_id));

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

  const formattedDate = new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  let sent = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    const employee = empMap.get(`${schedule.org_id}:${schedule.employee_id}`);
    if (!employee?.user_id) {
      skipped++;
      continue;
    }

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
