import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { notify } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);

  // Cron has no authenticated user session — use admin client to read schedules/employees,
  // then use the same client to call SECURITY DEFINER notify RPCs.
  const supabase = createAdminClient();

  const { data: schedules, error: schedErr } = await supabase
    .from("schedules")
    .select("id, employee_id, date, start_minutes, end_minutes")
    .eq("date", date);

  if (schedErr) {
    return NextResponse.json({ error: schedErr.message }, { status: 500 });
  }

  if (!schedules || schedules.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  const employeeIds = [...new Set(schedules.map((s) => s.employee_id))];

  const { data: employees, error: empErr } = await supabase
    .from("employees")
    .select("id, name, user_id")
    .in("id", employeeIds);

  if (empErr) {
    return NextResponse.json({ error: empErr.message }, { status: 500 });
  }

  const empMap = new Map(
    (employees ?? []).map((e) => [e.id, e])
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
    const employee = empMap.get(schedule.employee_id);
    if (!employee?.user_id) {
      skipped++;
      continue;
    }

    const startTime = fmtMinutes(schedule.start_minutes);
    const endTime = fmtMinutes(schedule.end_minutes);

    await notify(supabase, {
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
