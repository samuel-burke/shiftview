import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { localDayBoundsUtc, todayKeyInTz } from "@/lib/punch-date-utils";

export const dynamic = "force-dynamic";

// GET /api/punches/missed
// Returns the most recent open session from a previous day, if any.
// Used by the clock page on load so associates see the correction requirement
// before they attempt to clock in.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ missedPunch: null });

  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!emp) return NextResponse.json({ missedPunch: null });

  const { data: settingsData } = await supabase.from("app_settings").select("key, value");
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = settingsMap.timezone ?? "America/New_York";
  const todayKey = todayKeyInTz(tz);
  const { start: todayStart } = localDayBoundsUtc(todayKey, tz);

  const { data: prevPunch } = await supabase
    .from("punch_records")
    .select("punch_type, punched_at")
    .eq("employee_id", emp.id)
    .lt("punched_at", todayStart.toISOString())
    .order("punched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!prevPunch || prevPunch.punch_type === "clock_out") {
    return NextResponse.json({ missedPunch: null });
  }

  const missedDate = new Date(prevPunch.punched_at as string)
    .toLocaleDateString("en-CA", { timeZone: tz });

  return NextResponse.json({
    missedPunch: {
      date: missedDate,
      lastPunchType: prevPunch.punch_type,
      lastPunchedAt: prevPunch.punched_at,
      suggestedPunchType: "clock_out",
    },
  });
}
