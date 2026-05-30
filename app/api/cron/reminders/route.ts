import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";
import { fmtMinutes } from "@/data/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET) {
    console.error("[cron/reminders] CRON_SECRET env var is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  if (secret !== process.env.CRON_SECRET)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  const { data: settingsData } = await supabase.from("app_settings").select("key, value");
  const settingsMap = Object.fromEntries((settingsData ?? []).map((r) => [r.key, r.value]));
  if (settingsMap.email_notifications !== "true") {
    return NextResponse.json({ sent: 0, skipped: 0, reason: "notifications disabled" });
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

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

  const formattedDate = tomorrow.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });

  const results = await Promise.allSettled(
    schedules.map(async (s: { employee_id: number; start_minutes: number; end_minutes: number }) => {
      const emp = empMap[s.employee_id];
      if (!emp?.email) return "skipped";
      await sendEmail({
        to: emp.email,
        subject: `Your shift tomorrow — ${formattedDate}`,
        html: `<p>Hi ${emp.name},</p><p>You're scheduled tomorrow, <strong>${formattedDate}</strong>:</p><p style="font-size:20px;font-weight:bold">${fmtMinutes(s.start_minutes)} – ${fmtMinutes(s.end_minutes)}</p><p>— ShiftView</p>`,
      });
      return "sent";
    })
  );
  const sent = results.filter(r => r.status === "fulfilled" && r.value === "sent").length;
  const skipped = results.filter(r => r.status === "fulfilled" && r.value === "skipped").length;
  const failed = results.filter(r => r.status === "rejected").length;
  return NextResponse.json({ sent, skipped, failed });
}
