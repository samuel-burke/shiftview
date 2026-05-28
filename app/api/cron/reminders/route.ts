import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { fmtMinutes } from "@/data/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const supabase = await createClient();
  const { data: schedules, error } = await supabase
    .from("schedules")
    .select("employee_id, start_minutes, end_minutes")
    .eq("date", tomorrowStr);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!schedules || schedules.length === 0)
    return NextResponse.json({ sent: 0, skipped: 0 });

  const empIds = schedules.map((s: { employee_id: number }) => s.employee_id);
  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, email")
    .in("id", empIds);

  const empMap = Object.fromEntries(
    (employees ?? []).map((e: { id: number; name: string; email: string | null }) => [e.id, e])
  );

  let sent = 0;
  let skipped = 0;
  const formattedDate = tomorrow.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });

  await Promise.all(
    schedules.map(async (s: { employee_id: number; start_minutes: number; end_minutes: number }) => {
      const emp = empMap[s.employee_id];
      if (!emp?.email) { skipped++; return; }
      await sendEmail({
        to: emp.email,
        subject: `Your shift tomorrow — ${formattedDate}`,
        html: `<p>Hi ${emp.name},</p><p>You're scheduled tomorrow, <strong>${formattedDate}</strong>:</p><p style="font-size:20px;font-weight:bold">${fmtMinutes(s.start_minutes)} – ${fmtMinutes(s.end_minutes)}</p><p>— ShiftView</p>`,
      });
      sent++;
    })
  );

  return NextResponse.json({ sent, skipped });
}
